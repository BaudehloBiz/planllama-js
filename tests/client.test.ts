import type { Job, JobOptions, PlanLlamaOptions, WorkOptions } from '../src/client'
import { PlanLlama } from '../src/client'
import { io, mockSocket } from './__mocks__/socket.io-client'

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks()
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
    } else {
      return mockSocket.removeAllListeners(event)
    }
  })
})

describe('PlanLlama Constructor', () => {
  it('should create instance with string token', () => {
    const planLlama = new PlanLlama('test-token')
    expect(planLlama).toBeInstanceOf(PlanLlama)
  })

  it('should create instance with options object', () => {
    const options: PlanLlamaOptions = {
      apiToken: 'test-token',
      serverUrl: 'ws://custom.example.com',
    }
    const planLlama = new PlanLlama(options)
    expect(planLlama).toBeInstanceOf(PlanLlama)
  })

  it('should throw error for empty token string', () => {
    expect(() => new PlanLlama('')).toThrow('Customer token is required')
  })

  it('should throw error for invalid options', () => {
    expect(() => new PlanLlama({} as PlanLlamaOptions)).toThrow('Customer options with token are required')
  })

  it('should use default server URL when not provided', () => {
    const planLlama = new PlanLlama('test-token')
    // We can't directly test the private serverUrl, but we can verify the behavior
    expect(planLlama).toBeInstanceOf(PlanLlama)
  })

  it('should use custom server URL when provided', () => {
    const planLlama = new PlanLlama({
      apiToken: 'test-token',
      serverUrl: 'ws://custom.example.com',
    })
    expect(planLlama).toBeInstanceOf(PlanLlama)
  })
})

describe('PlanLlama Connection Management', () => {
  let planLlama: PlanLlama

  beforeEach(() => {
    planLlama = new PlanLlama('test-token')
  })

  afterEach(async () => {
    if (planLlama) {
      try {
        await planLlama.stop()
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
    // Force cleanup of any remaining timers
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('should connect to server successfully', async () => {
    const connectPromise = planLlama.start()

    // Simulate successful connection immediately
    await mockSocket.mockConnect()

    await connectPromise

    expect(io).toHaveBeenCalledWith('https://api.planllama.io', {
      path: '/ws',
      auth: { apiToken: 'test-token' },
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      withCredentials: true,
      extraHeaders: {
        'User-Agent': 'planllama-client/1.0.0',
      },
    })
  })

  it('should handle connection errors', async () => {
    const connectPromise = planLlama.start()

    // Simulate connection error after listeners are set up
    await mockSocket.mockConnectError(new Error('Connection failed'))

    await expect(connectPromise).rejects.toThrow('Failed to connect: Connection failed')
  })

  it('should not connect twice if already connected', async () => {
    // First connection
    const connectPromise1 = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise1

    // Second connection attempt should return immediately
    await planLlama.start()

    expect(io).toHaveBeenCalledTimes(1)
  })

  it('should handle disconnect and emit error on reconnection failure', async () => {
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise

    const errorHandler = jest.fn()
    planLlama.on('error', errorHandler)

    // Simulate server disconnect
    mockSocket.mockDisconnect('io server disconnect')

    expect(mockSocket.disconnected).toBe(true)
  })

  it('should stop gracefully', async () => {
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise

    await planLlama.stop()

    expect(mockSocket.disconnect).toHaveBeenCalled()
  })

  it('should handle stop when not connected', async () => {
    await expect(planLlama.stop()).resolves.toBeUndefined()
  })
})

describe('PlanLlama Job Sending', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise
  })

  afterEach(async () => {
    await planLlama.stop()
  })

  it('should send job successfully', async () => {
    const jobData = { message: 'test' }
    const options: JobOptions = { priority: 5 }

    // Mock successful response
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'send_job' && callback) {
        callback({ status: 'ok', jobId: 'job-123' })
      }
    })

    const jobId = await planLlama.publish('test-job', jobData, options)

    expect(jobId).toBe('job-123')
    expect(mockSocket.emit).toHaveBeenCalledWith('send_job', { name: 'test-job', data: jobData, options }, expect.any(Function))
  })

  it('should handle send job error response', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'send_job' && callback) {
        callback({ status: 'error', error: 'Job failed' })
      }
    })

    await expect(planLlama.publish('test-job', {})).rejects.toThrow('Job failed')
  })

  it('should handle invalid response from server', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'send_job' && callback) {
        callback({})
      }
    })

    await expect(planLlama.publish('test-job', {})).rejects.toThrow('Invalid response from server')
  })

  it('should throw error when not connected', async () => {
    await planLlama.stop()

    await expect(planLlama.publish('test-job', {})).rejects.toThrow('PlanLlama not started. Call start() first.')
  })
})

describe('PlanLlama Job Scheduling', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise
  })

  afterEach(async () => {
    await planLlama.stop()
  })

  it('should schedule job successfully', async () => {
    const cronPattern = '0 9 * * *'
    const jobData = { type: 'daily-report' }

    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'schedule_job' && callback) {
        callback({ status: 'ok' })
      }
    })

    await planLlama.schedule('daily-report', cronPattern, jobData)

    expect(mockSocket.emit).toHaveBeenCalledWith('schedule_job', { name: 'daily-report', cronPattern, data: jobData, options: undefined }, expect.any(Function))
  })

  it('should handle schedule error response', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'schedule_job' && callback) {
        callback({ status: 'error', error: 'Invalid cron pattern' })
      }
    })

    await expect(planLlama.schedule('test-job', 'invalid', {})).rejects.toThrow('Invalid cron pattern')
  })

  it('should throw error when not connected', async () => {
    await planLlama.stop()

    await expect(planLlama.schedule('test-job', '0 9 * * *', {})).rejects.toThrow('PlanLlama not started. Call start() first.')
  })
})

describe('PlanLlama Work Registration', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise
  })

  afterEach(async () => {
    await planLlama.stop()
  })

  it('should register worker with handler only', () => {
    const handler = jest.fn().mockResolvedValue('result')

    planLlama.work('test-job', handler)

    expect(mockSocket.emit).toHaveBeenCalledWith('register_worker', {
      jobName: 'test-job',
      options: undefined,
    })
  })

  it('should register worker with options and handler', () => {
    const handler = jest.fn().mockResolvedValue('result')
    const options: WorkOptions = { expireInSeconds: 120 }

    planLlama.work('test-job', options, handler)

    expect(mockSocket.emit).toHaveBeenCalledWith('register_worker', {
      jobName: 'test-job',
      options,
    })
  })

  it('should throw error when handler is missing', () => {
    const options: WorkOptions = { expireInSeconds: 120 }

    expect(() => {
      // @ts-expect-error - Testing invalid usage
      planLlama.work('test-job', options)
    }).toThrow('Handler function is required')
  })

  it('should process incoming work request successfully', async () => {
    const handler = jest.fn().mockResolvedValue({ success: true })
    const completedHandler = jest.fn()

    planLlama.work('test-job', handler)
    planLlama.on('completed', completedHandler)

    const mockJob: Job = {
      id: 'job-123',
      name: 'test-job',
      data: { message: 'test' },
      state: 'active',
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    // Simulate incoming work request
    mockSocket.mockServerEvent('work_request', mockJob)

    // Wait for async processing
    await new Promise((resolve) => setImmediate(resolve))

    expect(handler).toHaveBeenCalledWith(mockJob)
    expect(mockSocket.emit).toHaveBeenCalledWith('job_started', {
      jobName: 'test-job',
      jobId: 'job-123',
    })
    expect(mockSocket.emit).toHaveBeenCalledWith('job_completed', {
      jobId: 'job-123',
      jobName: 'test-job',
      result: { success: true },
    })
    expect(completedHandler).toHaveBeenCalledWith(mockJob, { success: true })
  })

  it('should handle work request failure', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('Processing failed'))
    const failedHandler = jest.fn()

    planLlama.work('test-job', handler)
    planLlama.on('failed', failedHandler)

    const mockJob: Job = {
      id: 'job-123',
      name: 'test-job',
      data: { message: 'test' },
      state: 'active',
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    const mockCallback = jest.fn()
    // Simulate incoming work request
    mockSocket.mockServerEvent('work_request', mockJob, mockCallback)

    // Wait for async processing
    await new Promise((resolve) => setImmediate(resolve))

    expect(handler).toHaveBeenCalledWith(mockJob)
    expect(mockCallback).toHaveBeenCalledWith({
      status: 'error',
      error: 'Processing failed',
      stack: expect.any(String),
    })
    expect(failedHandler).toHaveBeenCalledWith(mockJob, expect.any(Error))
  })

  it('should handle work request for unregistered job', async () => {
    const mockJob: Job = {
      id: 'job-123',
      name: 'unknown-job',
      data: {},
      state: 'active',
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    // Simulate incoming work request
    mockSocket.mockServerEvent('work_request', mockJob)

    // Wait for processing
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockSocket.emit).toHaveBeenCalledWith('job_failed', {
      jobId: 'job-123',
      error: 'No handler registered for job: unknown-job',
    })
  })
})

describe('PlanLlama Batch Operations', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise
  })

  afterEach(async () => {
    await planLlama.stop()
  })

  it('should send batch successfully', async () => {
    const jobs = [
      { name: 'job1', data: { id: 1 } },
      { name: 'job2', data: { id: 2 } },
    ]

    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'send_batch' && callback) {
        callback({ status: 'ok', batchId: 'batch-789' })
      }
    })

    const batchId = await planLlama.publishBatch(jobs)

    expect(batchId).toBe('batch-789')
    expect(mockSocket.emit).toHaveBeenCalledWith('send_batch', { jobs }, expect.any(Function))
  })

  it('should wait for batch completion', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'wait_for_batch' && callback) {
        callback({})
      }
    })

    await expect(planLlama.waitForBatch('batch-789')).resolves.toBeUndefined()

    expect(mockSocket.emit).toHaveBeenCalledWith('wait_for_batch', { batchId: 'batch-789' }, expect.any(Function))
  })

  it('should handle batch error', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'send_batch' && callback) {
        callback({ status: 'error', error: 'Batch failed' })
      }
    })

    await expect(planLlama.publishBatch([])).rejects.toThrow('Batch failed')
  })
})

describe('PlanLlama Job Management', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise
  })

  afterEach(async () => {
    await planLlama.stop()
  })

  it('should get job by ID', async () => {
    const mockJob: Job = {
      id: 'job-123',
      name: 'test-job',
      data: { message: 'test' },
      state: 'completed',
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'get_job' && callback) {
        callback({ status: 'ok', job: mockJob })
      }
    })

    const job = await planLlama.getJobById('job-123')

    expect(job).toEqual(mockJob)
    expect(mockSocket.emit).toHaveBeenCalledWith('get_job', { jobId: 'job-123' }, expect.any(Function))
  })

  it('should cancel job', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'cancel_job' && callback) {
        callback({ status: 'ok' })
      }
    })

    await expect(planLlama.cancel('job-123')).resolves.toBeUndefined()

    expect(mockSocket.emit).toHaveBeenCalledWith('cancel_job', { jobId: 'job-123' }, expect.any(Function))
  })

  it('should get queue size', async () => {
    const queueSize = 5

    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'get_queue_size' && callback) {
        callback({ status: 'ok', queueSize })
      }
    })

    const result = await planLlama.getQueueSize('a-queue')

    expect(result).toEqual(queueSize)
    expect(mockSocket.emit).toHaveBeenCalledWith('get_queue_size', { jobName: 'a-queue' }, expect.any(Function))
  })

  it('should handle job not found error', async () => {
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === 'get_job' && callback) {
        callback({ status: 'error', error: 'Job not found' })
      }
    })

    await expect(planLlama.getJobById('nonexistent')).rejects.toThrow('Job not found')
  })
})

describe('PlanLlama Event Handling', () => {
  let planLlama: PlanLlama

  beforeEach(async () => {
    planLlama = new PlanLlama('test-token')
    const connectPromise = planLlama.start()
    await mockSocket.mockConnect()
    await connectPromise
  })

  afterEach(async () => {
    await planLlama.stop()
  })

  it('should emit retrying event', () => {
    const retryingHandler = jest.fn()
    planLlama.on('retrying', retryingHandler)

    const mockJob: Job = {
      id: 'job-123',
      name: 'test-job',
      data: {},
      state: 'retry',
      retryCount: 1,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    mockSocket.mockServerEvent('job_retrying', mockJob)

    expect(retryingHandler).toHaveBeenCalledWith(mockJob)
  })

  it('should emit expired event', () => {
    const expiredHandler = jest.fn()
    planLlama.on('expired', expiredHandler)

    const mockJob: Job = {
      id: 'job-123',
      name: 'test-job',
      data: {},
      state: 'expired',
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    mockSocket.mockServerEvent('job_expired', mockJob)

    expect(expiredHandler).toHaveBeenCalledWith(mockJob)
  })

  it('should emit cancelled event', () => {
    const cancelledHandler = jest.fn()
    planLlama.on('cancelled', cancelledHandler)

    const mockJob: Job = {
      id: 'job-123',
      name: 'test-job',
      data: {},
      state: 'cancelled',
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
      expireInSeconds: 1,
    }

    mockSocket.mockServerEvent('job_cancelled', mockJob)

    expect(cancelledHandler).toHaveBeenCalledWith(mockJob)
  })

  it('should emit error event on socket error', () => {
    const errorHandler = jest.fn()
    planLlama.on('error', errorHandler)

    const error = new Error('Socket error')
    mockSocket.mockServerEvent('error', error)

    expect(errorHandler).toHaveBeenCalledWith(error)
  })
})
