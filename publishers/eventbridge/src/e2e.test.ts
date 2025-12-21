import { PutEventsCommand } from "@aws-sdk/client-eventbridge"
import { InMemoryOutbox, OutboxEventBus } from "outbox-event-bus"
import { describe, expect, it, vi } from "vitest"
import { EventBridgePublisher } from "./eventbridge-publisher"

describe("EventBridgePublisher E2E (with InMemoryOutbox)", () => {
  it("should process event from outbox to Event Bridge", async () => {
    // 1. Setup
    const outbox = new InMemoryOutbox({ onError: (err) => console.error(err) })
    const bus = new OutboxEventBus(
      outbox,
      () => {},
      (err) => console.error(err)
    )

    const mockEventBridgeClient = {
      send: vi.fn().mockResolvedValue({}),
    }

    const publisher = new EventBridgePublisher(bus, {
      eventBridgeClient: mockEventBridgeClient as any,
      source: "my.service",
      eventBusName: "my-bus",
    })

    publisher.subscribe(["test.event"])

    await bus.start()

    // 2. Emit event
    const event = {
      id: "evt_1",
      type: "test.event",
      payload: { foo: "bar" },
      occurredAt: new Date(),
    }

    await bus.emit(event)

    // 3. Verify
    // Wait for the asynchronous processing in InMemoryOutbox
    for (let i = 0; i < 10; i++) {
      if (mockEventBridgeClient.send.mock.calls.length > 0) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    expect(mockEventBridgeClient.send).toHaveBeenCalled()
    const command = mockEventBridgeClient.send.mock.calls[0][0] as PutEventsCommand
    expect(command).toBeInstanceOf(PutEventsCommand)
    expect(command.input.Entries).toBeDefined()
    const entry = command.input.Entries![0]
    expect(entry.DetailType).toBe("test.event")
    expect(entry.Detail).toContain('"foo":"bar"')
    expect(entry.Source).toBe("my.service")
    expect(entry.EventBusName).toBe("my-bus")

    await bus.stop()
  })
})
