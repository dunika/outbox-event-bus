import Database from "better-sqlite3"
import { MaxRetriesExceededError } from "outbox-event-bus"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OutboxEventBus } from "../../../core/src/outbox-event-bus"
import { SqliteBetterSqlite3Outbox } from "./sqlite-better-sqlite3-outbox"

describe("Error Handling", () => {
  let db: Database.Database
  let outbox: SqliteBetterSqlite3Outbox
  let bus: OutboxEventBus<any>

  beforeEach(() => {
    db = new Database(":memory:")

    outbox = new SqliteBetterSqlite3Outbox({
      db,
      pollIntervalMs: 10,
      maxRetries: 3,
    })
  })

  afterEach(async () => {
    await bus?.stop()
    db.close()
  })

  it("should call onError with event and retry count when handler fails", async () => {
    const onError = vi.fn()
    bus = new OutboxEventBus(outbox, onError)
    bus.start()

    const eventType = "test-event"
    const error = new Error("Handler failed")

    // Register a handler that fails
    bus.on(eventType, async () => {
      throw error
    })

    await bus.emit({
      type: eventType,
      payload: { data: "test" },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(onError).toHaveBeenCalled()
    const call = onError.mock.calls[0]
    expect(call).toBeDefined()
    const [calledError, calledEvent] = call!

    expect(calledError).toEqual(error)
    expect(calledEvent).toBeDefined()
    expect(calledEvent.type).toBe(eventType)
    expect(calledEvent.retryCount).toBe(1)
  })

  it("should increment retry count on subsequent failures", async () => {
    const onError = vi.fn()
    bus = new OutboxEventBus(outbox, onError)
    bus.start()

    const eventType = "test-event-retry"

    bus.on(eventType, async () => {
      throw new Error("Fail again")
    })

    await bus.emit({
      type: eventType,
      payload: { data: "test" },
    })
    console.log("Events after emit:", db.prepare("SELECT * FROM outbox_events").all())

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(onError).toHaveBeenCalledTimes(1)

    // Manually reset next_retry_at so it picks it up immediately (simulating time passing)
    db.prepare("UPDATE outbox_events SET next_retry_at = '1970-01-01'").run()
    console.log("Events after update:", db.prepare("SELECT * FROM outbox_events").all())
    console.log("Archive after update:", db.prepare("SELECT * FROM outbox_events_archive").all())

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(onError).toHaveBeenCalledTimes(2)
    const secondCallEvent = onError.mock.calls[1]?.[1]
    expect(secondCallEvent).toBeDefined()
    expect(secondCallEvent.retryCount).toBe(2)
  })

  it("should call onError with MaxRetriesExceededError when max retries is reached", async () => {
    const onError = vi.fn()
    // Set maxRetries to 1 for quick test
    outbox = new SqliteBetterSqlite3Outbox({
      db,
      pollIntervalMs: 10,
      maxRetries: 1,
    })
    bus = new OutboxEventBus(outbox, onError)
    bus.start()

    const eventType = "test-event-max-retries"
    bus.on(eventType, async () => {
      throw new Error("Fatal")
    })

    await bus.emit({
      type: eventType,
      payload: { data: "test" },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(onError).toHaveBeenCalled()
    const error = onError.mock.calls[0]?.[0]
    expect(error).toBeInstanceOf(MaxRetriesExceededError)
    expect((error as MaxRetriesExceededError).retryCount).toBe(1)
  })
})
