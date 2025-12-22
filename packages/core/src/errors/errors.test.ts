import { describe, expect, it } from "vitest"
import {
  BackpressureError,
  BatchSizeLimitError,
  ConfigurationError,
  DuplicateListenerError,
  HandlerError,
  MaintenanceError,
  MaxRetriesExceededError,
  OperationalError,
  OutboxError,
  TimeoutError,
  UnsupportedOperationError,
  ValidationError,
} from "./errors"

describe("Errors", () => {
  describe("OutboxError", () => {
    it("should be an instance of Error", () => {
      const error = new ConfigurationError("test")
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(OutboxError)
    })

    it("should store context", () => {
      const context = { foo: "bar" }
      const error = new ConfigurationError("test", context)
      expect(error.context).toEqual(context)
    })

    it("should set cause from context.cause", () => {
      const original = new Error("original")
      const error = new ConfigurationError("test", { cause: original })
      expect(error.cause).toBe(original)
    })
  })

  describe("ConfigurationError", () => {
    it("should have correct name", () => {
      const error = new ConfigurationError("test")
      expect(error.name).toBe("ConfigurationError")
    })
  })

  describe("DuplicateListenerError", () => {
    it("should be a ConfigurationError", () => {
      const error = new DuplicateListenerError("event-type")
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error.name).toBe("DuplicateListenerError")
      expect(error.message).toContain("event-type")
    })
  })

  describe("UnsupportedOperationError", () => {
    it("should be a ConfigurationError", () => {
      const error = new UnsupportedOperationError("operation")
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error.name).toBe("UnsupportedOperationError")
      expect(error.message).toContain("operation")
    })
  })

  describe("ValidationError", () => {
    it("should have correct name", () => {
      const error = new ValidationError("test")
      expect(error.name).toBe("ValidationError")
    })
  })

  describe("BatchSizeLimitError", () => {
    it("should be a ValidationError", () => {
      const error = new BatchSizeLimitError(100, 101)
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.name).toBe("BatchSizeLimitError")
    })
  })

  describe("OperationalError", () => {
    it("should have correct name", () => {
      const error = new OperationalError("test")
      expect(error.name).toBe("OperationalError")
    })
  })

  describe("TimeoutError", () => {
    it("should be an OperationalError", () => {
      const error = new TimeoutError("event-type", 1000)
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe("TimeoutError")
      expect(error.message).toContain("event-type")
      expect(error.message).toContain("1000ms")
    })
  })

  describe("BackpressureError", () => {
    it("should be an OperationalError", () => {
      const error = new BackpressureError("full")
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe("BackpressureError")
    })
  })

  describe("MaintenanceError", () => {
    it("should be an OperationalError", () => {
      const error = new MaintenanceError("failed")
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe("MaintenanceError")
    })
  })

  describe("MaxRetriesExceededError", () => {
    it("should be an OperationalError", () => {
      const original = new Error("original")
      const event = {
        id: "1",
        type: "test",
        payload: {},
        occurredAt: new Date(),
        retryCount: 5,
      }
      const error = new MaxRetriesExceededError(original, event)
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe("MaxRetriesExceededError")
      expect(error.message).toContain("5")
      expect(error.retryCount).toBe(5)
      expect(error.cause).toBe(original)
      expect(error.event).toBe(event)
    })
  })

  describe("HandlerError", () => {
    it("should be an OutboxError", () => {
      const original = new Error("original")
      const event = { id: "1", type: "test", payload: {}, occurredAt: new Date() }
      const error = new HandlerError(original, event)
      expect(error).toBeInstanceOf(OutboxError)
      expect(error.name).toBe("HandlerError")
      expect(error.cause).toBe(original)
      expect(error.event).toBe(event)
    })
  })
})
