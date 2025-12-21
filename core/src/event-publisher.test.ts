import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventPublisher } from "./event-publisher"
import type { BusEvent } from "./types"
import type { IOutboxEventBus } from "./interfaces"

describe("EventPublisher", () => {
  let mockBus: IOutboxEventBus
  let publisher: EventPublisher
  let mockHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockBus = {
      subscribe: vi.fn(),
    } as unknown as IOutboxEventBus

    mockHandler = vi.fn()
    publisher = new EventPublisher(mockBus, {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
    })
  })

  it("should subscribe to events on the bus", () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (event: BusEvent) => Promise<void>)
    expect(mockBus.subscribe).toHaveBeenCalledWith(
      ["TEST_EVENT"],
      expect.any(Function)
    )
  })

  it("should execute handler with retry logic", async () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (event: BusEvent) => Promise<void>)
    const busHandler = (mockBus.subscribe as any).mock.calls[0][1]

    const event: BusEvent = {
      id: "1",
      type: "TEST_EVENT",
      payload: {},
      occurredAt: new Date(),
    }

    await busHandler(event)

    expect(mockHandler).toHaveBeenCalledWith(event)
  })

  it("should retry failed handler execution", async () => {
    publisher.subscribe(["TEST_EVENT"], mockHandler as unknown as (event: BusEvent) => Promise<void>)
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
})
