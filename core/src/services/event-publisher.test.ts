import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventPublisher } from "./event-publisher"
import type { BusEvent } from "../types/types"
import type { IOutboxEventBus } from "../types/interfaces"

describe("EventPublisher", () => {
  let mockBus: IOutboxEventBus<unknown>
  let publisher: EventPublisher<unknown>
  let mockHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockBus = {
      subscribe: vi.fn(),
    } as unknown as IOutboxEventBus<unknown>

    mockHandler = vi.fn()
    publisher = new EventPublisher(mockBus, {
      retryConfig: {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      }
    })
  })

  it("should subscribe to events on the bus", () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (events: BusEvent[]) => Promise<void>)
    expect(mockBus.subscribe).toHaveBeenCalledWith(
      ["TEST_EVENT"],
      expect.any(Function)
    )
  })

  it("should execute handler with retry logic", async () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (events: BusEvent[]) => Promise<void>)
    const busHandler = (mockBus.subscribe as any).mock.calls[0][1]

    const event: BusEvent = {
      id: "1",
      type: "TEST_EVENT",
      payload: {},
      occurredAt: new Date(),
    }

    await busHandler(event)

    expect(mockHandler).toHaveBeenCalledWith([event])
  })

  it("should retry failed handler execution", async () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (events: BusEvent[]) => Promise<void>)
    const busHandler = (mockBus.subscribe as any).mock.calls[0][1]

    const event: BusEvent = {
        id: "1",
        type: "TEST_EVENT",
        payload: {},
        occurredAt: new Date(),
    }

    mockHandler
      .mockRejectedValueOnce(new Error("Fail 1"))
      .mockResolvedValueOnce(undefined)

    await busHandler(event)

    expect(mockHandler).toHaveBeenCalledTimes(2)
  })

  it("should batch multiple events", async () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (events: BusEvent[]) => Promise<void>)
    const busHandler = (mockBus.subscribe as any).mock.calls[0][1]

    const events: BusEvent[] = [
      { id: "1", type: "TEST_EVENT", payload: {} },
      { id: "2", type: "TEST_EVENT", payload: {} },
    ]

    // Send 2 events, they should be batched (default batchSize is 100)
    // We await both to ensure they both get added and wait for the same flush
    await Promise.all([
      busHandler(events[0]),
      busHandler(events[1]),
    ])

    expect(mockHandler).toHaveBeenCalledWith(events)
    expect(mockHandler).toHaveBeenCalledTimes(1)
  })
})

