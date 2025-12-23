import { RabbitMQPublisher } from "@outbox-event-bus/rabbitmq-publisher"
import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq"
import amqp from "amqplib"
import { InMemoryOutbox, OutboxEventBus } from "outbox-event-bus"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { RoutingSlipBuilder } from "../../src/builder/routing-slip-builder.js"
import { ActivityRegistry } from "../../src/engine/activity-registry.js"
import { SagaEngine } from "../../src/engine/saga-engine.js"
import type { Activity } from "../../src/types/interfaces.js"

describe("Saga E2E with RabbitMQ", () => {
  let container: StartedRabbitMQContainer
  let connection: amqp.Connection
  let channel: amqp.Channel
  let bus: OutboxEventBus<unknown>
  let engine: SagaEngine
  let registry: ActivityRegistry
  let outbox: InMemoryOutbox

  beforeAll(async () => {
    container = await new RabbitMQContainer("rabbitmq:3-management").start()
    const url = container.getAmqpUrl()
    connection = await amqp.connect(url)
    channel = await connection.createChannel()

    outbox = new InMemoryOutbox()
    bus = new OutboxEventBus(outbox, {
      onError: (err) => console.error("Bus Error:", err),
    })

    const publisher = new RabbitMQPublisher(bus, {
      channel,
      exchange: "saga-exchange",
    })
    publisher.subscribe(["step1", "step2"])

    registry = new ActivityRegistry()
    engine = new SagaEngine({ bus, registry })
    bus.addHandlerMiddleware(engine.middleware())

    // Start the bus processing
    bus.start()
  }, 60000)

  afterAll(async () => {
    await bus?.stop()
    await channel?.close()
    await connection?.close()
    await container?.stop()
  })

  it("should execute a multi-step saga through RabbitMQ", async () => {
    const step1Executed = vi.fn()
    const step2Executed = vi.fn()

    const activity1: Activity = {
      name: "step1",
      execute: async (args) => {
        step1Executed(args)
        return { step1: "done" }
      },
      compensate: async () => {},
    }

    const activity2: Activity = {
      name: "step2",
      execute: async (args) => {
        step2Executed(args)
        return { step2: "done" }
      },
      compensate: async () => {},
    }

    registry.register(activity1)
    registry.register(activity2)

    // Setup RabbitMQ consumers to simulate distributed services
    await channel.assertExchange("saga-exchange", "topic", { durable: false })
    const q1 = await channel.assertQueue("step1-queue", { exclusive: true })
    const q2 = await channel.assertQueue("step2-queue", { exclusive: true })

    await channel.bindQueue(q1.queue, "saga-exchange", "step1")
    await channel.bindQueue(q2.queue, "saga-exchange", "step2")

    await channel.consume(q1.queue, (msg) => {
      void (async () => {
        if (msg) {
          const event = JSON.parse(msg.content.toString())
          // Manually trigger the bus handler to simulate receiving the event
          await (bus as any).processEvent(event)
          channel.ack(msg)
        }
      })()
    })

    await channel.consume(q2.queue, (msg) => {
      void (async () => {
        if (msg) {
          const event = JSON.parse(msg.content.toString())
          await (bus as any).processEvent(event)
          channel.ack(msg)
        }
      })()
    })

    const slip = new RoutingSlipBuilder()
      .addActivity("step1", { data: "start" })
      .addActivity("step2", { data: "next" })
      .build()

    await engine.execute(slip)

    // Wait for E2E completion
    let completed = false
    const start = Date.now()
    while (!completed && Date.now() - start < 10000) {
      if (step1Executed.mock.calls.length > 0 && step2Executed.mock.calls.length > 0) {
        completed = true
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    expect(step1Executed).toHaveBeenCalledWith({ data: "start" })
    expect(step2Executed).toHaveBeenCalledWith({ data: "next" })
  }, 20000)

  it("should execute compensation flow through RabbitMQ on failure", async () => {
    const step1Executed = vi.fn()
    const step1Compensated = vi.fn()
    const step2Executed = vi.fn()

    const activity1: Activity = {
      name: "comp-step1",
      execute: async (args) => {
        step1Executed(args)
        return { step1: "done" }
      },
      compensate: async (data) => {
        step1Compensated(data)
      },
    }

    const activity2: Activity = {
      name: "comp-step2",
      execute: async () => {
        step2Executed()
        throw new Error("Step 2 failed")
      },
      compensate: async () => {},
    }

    registry.register(activity1)
    registry.register(activity2)

    // Setup RabbitMQ consumers
    const q1 = await channel.assertQueue("comp-step1-queue", { exclusive: true })
    const q2 = await channel.assertQueue("comp-step2-queue", { exclusive: true })

    await channel.bindQueue(q1.queue, "saga-exchange", "comp-step1")
    await channel.bindQueue(q2.queue, "saga-exchange", "comp-step2")

    await channel.consume(q1.queue, (msg) => {
      void (async () => {
        if (msg) {
          const event = JSON.parse(msg.content.toString())
          await (bus as any).processEvent(event)
          channel.ack(msg)
        }
      })()
    })

    await channel.consume(q2.queue, (msg) => {
      void (async () => {
        if (msg) {
          const event = JSON.parse(msg.content.toString())
          await (bus as any).processEvent(event)
          channel.ack(msg)
        }
      })()
    })

    const slip = new RoutingSlipBuilder()
      .addActivity("comp-step1", { data: "start" })
      .addActivity("comp-step2", {})
      .build()

    await engine.execute(slip)

    // Wait for E2E completion (compensation)
    let compensated = false
    const start = Date.now()
    while (!compensated && Date.now() - start < 10000) {
      if (step1Compensated.mock.calls.length > 0) {
        compensated = true
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    expect(step1Executed).toHaveBeenCalled()
    expect(step2Executed).toHaveBeenCalled()
    expect(step1Compensated).toHaveBeenCalledWith({ step1: "done" })
  }, 20000)
})
