
import { describe, it, expect } from 'vitest'
import {
  OutboxError,
  ConfigurationError,
  DuplicateListenerError,
  UnsupportedOperationError,
  ValidationError,
  BatchSizeLimitError,
  OperationalError,
  TimeoutError,
  BackpressureError,
  MaintenanceError,
  MaxRetriesExceededError,
} from './errors'

describe('Errors', () => {
  describe('OutboxError', () => {
    it('should be an instance of Error', () => {
      const error = new ConfigurationError('test')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(OutboxError)
    })

    it('should store context', () => {
      const context = { foo: 'bar' }
      const error = new ConfigurationError('test', context)
      expect(error.data).toEqual(context)
    })
  })

  describe('ConfigurationError', () => {
    it('should have correct name', () => {
      const error = new ConfigurationError('test')
      expect(error.name).toBe('ConfigurationError')
    })
  })

  describe('DuplicateListenerError', () => {
    it('should be a ConfigurationError', () => {
      const error = new DuplicateListenerError('event-type')
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error.name).toBe('DuplicateListenerError')
      expect(error.message).toContain('event-type')
    })
  })

  describe('UnsupportedOperationError', () => {
    it('should be a ConfigurationError', () => {
      const error = new UnsupportedOperationError('operation')
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error.name).toBe('UnsupportedOperationError')
      expect(error.message).toContain('operation')
    })
  })

  describe('ValidationError', () => {
    it('should have correct name', () => {
      const error = new ValidationError('test')
      expect(error.name).toBe('ValidationError')
    })
  })

  describe('BatchSizeLimitError', () => {
    it('should be a ValidationError', () => {
      const error = new BatchSizeLimitError(100, 101)
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.name).toBe('BatchSizeLimitError')
    })
  })

  describe('OperationalError', () => {
    it('should have correct name', () => {
      const error = new OperationalError('test')
      expect(error.name).toBe('OperationalError')
    })
  })

  describe('TimeoutError', () => {
    it('should be an OperationalError', () => {
      const error = new TimeoutError('event-type', 1000)
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe('TimeoutError')
      expect(error.message).toContain('event-type')
      expect(error.message).toContain('1000ms')
    })
  })

  describe('BackpressureError', () => {
    it('should be an OperationalError', () => {
      const error = new BackpressureError('full')
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe('BackpressureError')
    })
  })

  describe('MaintenanceError', () => {
    it('should be an OperationalError', () => {
      const error = new MaintenanceError('failed')
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe('MaintenanceError')
    })
  })

  describe('MaxRetriesExceededError', () => {
    it('should be an OperationalError', () => {
      const original = new Error('original')
      const error = new MaxRetriesExceededError(original, 5)
      expect(error).toBeInstanceOf(OperationalError)
      expect(error.name).toBe('MaxRetriesExceededError')
      expect(error.message).toContain('5')
      expect(error.originalError).toBe(original)
      expect(error.retryCount).toBe(5)
    })
  })
})
