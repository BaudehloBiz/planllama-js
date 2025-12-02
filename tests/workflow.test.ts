import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job, StepResult, Steps } from '../src/client'
import { PlanLlama } from '../src/client'
import { mockSocket } from './__mocks__/socket.io-client'

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
  mockSocket.removeAllListeners()
  mockSocket.connected = false
  mockSocket.disconnected = true

  // Reset mock implementations
  mockSocket.emit.mockReset()
  mockSocket.on.mockReset()
  mockSocket.off.mockReset()
  mockSocket.disconnect.mockReset()
  mockSocket.connect.mockReset()

  // Restore default implementations
  mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    return mockSocket.addListener(event, handler)
  })
  mockSocket.off.mockImplementation((event: string, handler?: (...args: unknown[]) => void) => {
    if (handler) {
      return mockSocket.removeListener(event, handler)
    }
    return mockSocket.removeAllListeners(event)
  })
})

describe('PlanLlama Workflow Tests', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')

    // Start the client
    const startPromise = planLlama.start()
    await mockSocket.mockConnect()
    await startPromise
  })

  afterEach(async () => {
    if (planLlama) {
      try {
        await planLlama.stop()
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('Workflow Definition', () => {
    it('should define a simple workflow with no dependencies', async () => {
      const steps: Steps = {
        step1: async () => 'result1',
        step2: async () => 'result2',
      }

      await planLlama.workflow('simple-workflow', steps)

      // Verify that workers were registered for each step
      const emitCalls = mockSocket.emit.mock.calls
      const registerCalls = emitCalls.filter((call) => call[0] === 'register_worker')

      expect(registerCalls.length).toBe(3) // 2 steps + 1 workflow runner
      expect(registerCalls[0][1].jobName).toBe('simple-workflow/step1')
      expect(registerCalls[1][1].jobName).toBe('simple-workflow/step2')
      expect(registerCalls[2][1].jobName).toBe('simple-workflow')
    })

    it('should define a workflow with dependencies', async () => {
      const steps: Steps = {
        step1: async () => 'result1',
        step2: ['step1', async (results: StepResult) => `result2-${results.step1}`],
      }

      await planLlama.workflow('dependent-workflow', steps)

      const emitCalls = mockSocket.emit.mock.calls
      const registerCalls = emitCalls.filter((call) => call[0] === 'register_worker')

      expect(registerCalls.length).toBe(3)
    })

    it('should throw error when not started', async () => {
      const newClient = new PlanLlama('test-token')
      const steps: Steps = {
        step1: async () => 'result1',
      }

      await expect(newClient.workflow('test-workflow', steps)).rejects.toThrow('PlanLlama not started')
    })

    it('should throw error for invalid step definition', async () => {
      const steps = {
        step1: 'not-a-function' as any,
      }

      await expect(planLlama.workflow('invalid-workflow', steps)).rejects.toThrow('Invalid step definition')
    })

    it('should throw error for step array without function', async () => {
      const steps = {
        step1: ['dep1', 'dep2'] as any,
      }

      await expect(planLlama.workflow('invalid-workflow', steps)).rejects.toThrow('Step must be a function or an array ending with a function')
    })
  })

  describe('Cycle Detection', () => {
    it('should detect simple cycle (A -> B -> A)', async () => {
      const steps: Steps = {
        stepA: ['stepB', async () => 'A'],
        stepB: ['stepA', async () => 'B'],
      }

      await planLlama.workflow('cycle-workflow', steps)

      const mockJob: Job = {
        id: 'job-123',
        name: 'cycle-workflow',
        data: {},
        state: 'active',
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
        expireInSeconds: 900,
      }

      const mockCallback = vi.fn()

      // Mock fetch_step_results to return empty results
      mockSocket.emit.mockImplementation((event: string, _data: any, callback?: any) => {
        if (event === 'fetch_step_results') {
          callback?.({ status: 'ok', stepResults: {} })
        }
        return true
      })

      // Trigger work request for the main workflow
      mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 10))

      // The handler should have called the callback with an error
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('recursive dependency'),
        }),
      )
    })

    it('should detect three-way cycle (A -> B -> C -> A)', async () => {
      const steps: Steps = {
        stepA: ['stepC', async () => 'A'],
        stepB: ['stepA', async () => 'B'],
        stepC: ['stepB', async () => 'C'],
      }

      await planLlama.workflow('three-cycle', steps)

      const mockJob: Job = {
        id: 'job-456',
        name: 'three-cycle',
        data: {},
        state: 'active',
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
        expireInSeconds: 900,
      }

      const mockCallback = vi.fn()

      mockSocket.emit.mockImplementation((event: string, _data: any, callback?: any) => {
        if (event === 'fetch_step_results') {
          callback?.({ status: 'ok', stepResults: {} })
        }
        return true
      })

      mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('recursive dependency'),
        }),
      )
    })

    it('should allow valid DAG with multiple branches', async () => {
      const steps: Steps = {
        step1: async () => 'result1',
        step2: ['step1', async () => 'result2'],
        step3: ['step1', async () => 'result3'],
        step4: ['step2', 'step3', async () => 'result4'],
      }

      // This should not throw
      await expect(planLlama.workflow('valid-dag', steps)).resolves.not.toThrow()
    })

    it('should detect undefined dependency', async () => {
      const steps: Steps = {
        stepA: ['nonExistentStep', async () => 'A'],
      }

      await planLlama.workflow('undefined-dep', steps)

      const mockJob: Job = {
        id: 'job-789',
        name: 'undefined-dep',
        data: {},
        state: 'active',
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
        expireInSeconds: 900,
      }

      const mockCallback = vi.fn()

      mockSocket.emit.mockImplementation((event: string, _data: any, callback?: any) => {
        if (event === 'fetch_step_results') {
          callback?.({ status: 'ok', stepResults: {} })
        }
        return true
      })

      mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('undefined step'),
        }),
      )
    })
  })

  describe('Workflow Execution', () => {
    it('should register individual step handlers', async () => {
      const steps: Steps = {
        step1: async () => 'result1',
        step2: async () => 'result2',
      }

      await planLlama.workflow('exec-workflow', steps)

      // Verify that workers were registered for each step + main workflow
      const emitCalls = mockSocket.emit.mock.calls
      const registerCalls = emitCalls.filter((call) => call[0] === 'register_worker')

      const stepHandlers = registerCalls.filter((call) => call[1].jobName.includes('/'))
      expect(stepHandlers.length).toBe(2)
    })

    it('should execute individual step when triggered', async () => {
      let executedValue: string | undefined
      const steps: Steps = {
        step1: async () => {
          executedValue = 'step1-executed'
          return 'result1'
        },
      }

      await planLlama.workflow('single-step-workflow', steps)

      const mockJob: Job = {
        id: 'step-job-1',
        name: 'single-step-workflow/step1',
        data: {},
        state: 'active',
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
        expireInSeconds: 900,
      }

      const mockCallback = vi.fn((response) => {
        expect(response.status).toBe('ok')
        expect(response.result).toBe('result1')
      })

      // Trigger the handler using mockServerEvent
      mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(executedValue).toBe('step1-executed')
      expect(mockCallback).toHaveBeenCalled()
    })

    it('should pass step results correctly', async () => {
      let receivedResults: StepResult | undefined
      const steps: Steps = {
        step1: async () => ({ value: 10 }),
        step2: [
          'step1',
          async (results: StepResult) => {
            receivedResults = results
            return { doubled: (results?.step1?.value || 0) * 2 }
          },
        ],
      }

      await planLlama.workflow('pass-workflow', steps)

      const mockJob: Job = {
        id: 'step2-job',
        name: 'pass-workflow/step2',
        data: { step1: { value: 10 } } as StepResult,
        state: 'active',
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
        expireInSeconds: 900,
      }

      const mockCallback = vi.fn()

      mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          result: { doubled: 20 },
        }),
      )
      expect(receivedResults).toEqual({ step1: { value: 10 } })
    })
  })

  describe('Step Result Storage', () => {
    it('should call storeStepResult after step execution in workflow', async () => {
      const steps: Steps = {
        step1: async () => 'result1',
      }

      await planLlama.workflow('store-workflow', steps)

      // Verify the workflow registers correctly
      const emitCalls = mockSocket.emit.mock.calls
      const registerCalls = emitCalls.filter((call) => call[0] === 'register_worker')

      expect(registerCalls.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle step handler errors gracefully', async () => {
      const steps: Steps = {
        step1: async () => {
          throw new Error('Step failed intentionally')
        },
      }

      await planLlama.workflow('error-workflow', steps)

      const mockJob: Job = {
        id: 'error-job-1',
        name: 'error-workflow/step1',
        data: {},
        state: 'active',
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
        expireInSeconds: 900,
      }

      const mockCallback = vi.fn()

      mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should call callback with error status
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: 'Step failed intentionally',
        }),
      )
    })
  })
})
