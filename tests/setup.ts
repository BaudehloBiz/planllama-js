// Global test setup
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

// Store original console methods
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const originalConsoleLog = console.log

beforeAll(() => {
  // Suppress console methods during tests unless specifically testing them
  console.error = vi.fn()
  console.warn = vi.fn()
  console.log = vi.fn()
})

afterAll(() => {
  // Restore original console methods
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
  console.log = originalConsoleLog
})

// Clean up after each test
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
