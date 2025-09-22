import type { Job } from "../src/client";
import { PlanLlama } from "../src/client";
import { mockSocket } from "./__mocks__/socket.io-client";

// Integration tests that test multiple components working together
describe("PlanLlama Integration Tests", () => {
	let planLlama: PlanLlama;

	beforeEach(async () => {
    jest.clearAllMocks();
    mockSocket.removeAllListeners();
    mockSocket.connected = false;
    mockSocket.disconnected = true;

    planLlama = new PlanLlama("test-token");

    // Start the connection process
    const connectPromise = planLlama.start();

    // Now trigger the mock connection
    await mockSocket.mockConnect();

    // Wait for connection to complete
    await connectPromise;
  });

  afterEach(async () => {
    await planLlama.stop();
  });

  it("should handle complete email workflow", async () => {
    const completedJobs: Job[] = [];
    const failedJobs: Job[] = [];

    // Set up event listeners
    planLlama.on("completed", (job) => completedJobs.push(job));
    planLlama.on("failed", (job) => failedJobs.push(job));

    // Register email handler
    planLlama.work("send-email", async (job) => {
      const { to, subject } = job.data as { to: string; subject: string };

      if (!to || !subject) {
        throw new Error("Missing required email fields");
      }

      // Simulate email service call
      return {
        messageId: `msg-${Date.now()}`,
        to,
        subject,
        status: "sent",
      };
    });

    // Mock server response for job sending
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === "send_job" && callback) {
        callback({ status: "ok", jobId: "email-job-123" });
      }
    });

    // Send an email job
    const jobId = await planLlama.send("send-email", {
      to: "user@example.com",
      subject: "Welcome!",
      body: "Thanks for signing up!",
    });

    expect(jobId).toBe("email-job-123");

    // Simulate server sending work request
    const emailJob: Job = {
      id: "email-job-123",
      name: "send-email",
      data: {
        to: "user@example.com",
        subject: "Welcome!",
        body: "Thanks for signing up!",
      },
      state: "active",
      retryCount: 0,
      priority: 0,
      createdAt: new Date(),
    };

    mockSocket.mockServerEvent("work_request", emailJob);

    // Wait for processing
    await new Promise((resolve) => setImmediate(resolve));

    // Verify job was processed successfully
    expect(completedJobs).toHaveLength(1);
    expect(failedJobs).toHaveLength(0);
    expect(completedJobs[0]?.id).toBe("email-job-123");

    // Verify server communication
    expect(mockSocket.emit).toHaveBeenCalledWith("job_started", {
      jobName: "send-email",
      jobId: "email-job-123",
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("job_completed", {
      jobId: "email-job-123",
      result: expect.objectContaining({
        status: "sent",
        to: "user@example.com",
        subject: "Welcome!",
      }),
    });
  });

  it("should handle job failure and retry workflow", async () => {
    const failedJobs: Job[] = [];
    const retryingJobs: Job[] = [];

    planLlama.on("failed", (job) => failedJobs.push(job));
    planLlama.on("retrying", (job) => retryingJobs.push(job));

    // Register a failing handler
    let attemptCount = 0;
    planLlama.work("flaky-job", async () => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error(`Attempt ${attemptCount} failed`);
      }
      return { success: true, attempts: attemptCount };
    });

    // Send job with retry options
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === "send_job" && callback) {
        callback({ status: "ok", jobId: "flaky-job-456" });
      }
    });

    const jobId = await planLlama.send(
      "flaky-job",
      { data: "test" },
      {
        retryLimit: 3,
        retryDelay: 1,
      }
    );

    expect(jobId).toBe("flaky-job-456");

    // Simulate multiple work requests (original + retries)
    const createJobAttempt = (retryCount: number): Job => ({
      id: "flaky-job-456",
      name: "flaky-job",
      data: { data: "test" },
      state: retryCount > 0 ? "retry" : "active",
      retryCount,
      priority: 0,
      createdAt: new Date(),
    });

    // First attempt (fails)
    mockSocket.mockServerEvent("work_request", createJobAttempt(0));
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate retry notification
    mockSocket.mockServerEvent("job_retrying", createJobAttempt(1));

    // Second attempt (fails)
    mockSocket.mockServerEvent("work_request", createJobAttempt(1));
    await new Promise((resolve) => setImmediate(resolve));

    // Third attempt (succeeds)
    mockSocket.mockServerEvent("work_request", createJobAttempt(2));
    await new Promise((resolve) => setImmediate(resolve));

    // Verify retry behavior
    expect(failedJobs).toHaveLength(2); // First two attempts failed
    expect(retryingJobs).toHaveLength(1); // One retry notification
    expect(attemptCount).toBe(3); // Handler was called 3 times
  });

  it("should handle batch processing workflow", async () => {
    const processedJobs: string[] = [];

    // Register batch processor
    planLlama.work("batch-item", async (job) => {
      const { id, data } = job.data as { id: string; data: string };
      processedJobs.push(id);

      // Simulate processing delay
      await new Promise((resolve) => setImmediate(resolve));

      return { processed: true, id, data };
    });

    // Mock batch sending
    mockSocket.emit.mockImplementation((event, _data, callback) => {
      if (event === "send_batch" && callback) {
        callback({ status: "ok", batchId: "batch-789" });
      } else if (event === "wait_for_batch" && callback) {
        callback({}); // TODO: have not implemented yet
      }
    });

    // Send batch
    const batchJobs = [
      { name: "batch-item", data: { id: "item-1", data: "data-1" } },
      { name: "batch-item", data: { id: "item-2", data: "data-2" } },
      { name: "batch-item", data: { id: "item-3", data: "data-3" } },
    ];

    const batchId = await planLlama.sendBatch(batchJobs);
    expect(batchId).toBe("batch-789");

    // Give worker registration time to complete
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate server sending work requests for batch items immediately
    for (let index = 0; index < batchJobs.length; index++) {
      const batchJob = batchJobs[index];
      const job: Job = {
        id: `batch-job-${index + 1}`,
        name: batchJob.name,
        data: batchJob.data,
        state: "active",
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
      };
      mockSocket.mockServerEvent("work_request", job);
      // Small delay between jobs to allow processing
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Wait for all jobs to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Wait for batch completion
    await planLlama.waitForBatch(batchId);

    // Verify all batch items were processed
    expect(processedJobs).toHaveLength(3);
    expect(processedJobs).toContain("item-1");
    expect(processedJobs).toContain("item-2");
    expect(processedJobs).toContain("item-3");
  });

  it("should handle concurrent job processing", async () => {
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    // Register handler with concurrency options
    planLlama.work(
      "concurrent-job",
      {
        teamSize: 3,
        teamConcurrency: 2,
      },
      async (job) => {
        const jobId = job.id;
        startTimes[jobId] = Date.now();

        // Simulate work that takes some time
        await new Promise((resolve) => setTimeout(resolve, 20));

        endTimes[jobId] = Date.now();
        return { jobId, processed: true };
      }
    );

    // Give worker registration time to complete
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate multiple concurrent work requests
    const jobIds = [
      "concurrent-1",
      "concurrent-2",
      "concurrent-3",
      "concurrent-4",
    ];

    // Send all jobs immediately to test concurrency
    for (const jobId of jobIds) {
      const job: Job = {
        id: jobId,
        name: "concurrent-job",
        data: { index: jobIds.indexOf(jobId) },
        state: "active",
        retryCount: 0,
        priority: 0,
        createdAt: new Date(),
      };
      mockSocket.mockServerEvent("work_request", job);
    }

    // Wait for all jobs to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify all jobs were processed
    expect(Object.keys(startTimes)).toHaveLength(4);
    expect(Object.keys(endTimes)).toHaveLength(4);

    // Verify concurrent execution (some jobs should overlap)
    const sortedStarts = Object.values(startTimes).sort();
    const sortedEnds = Object.values(endTimes).sort();

    // With concurrency, some jobs should start before others finish
    expect(sortedStarts[1]).toBeLessThan(sortedEnds[0]);
  });

  it("should handle reconnection scenario", async () => {
    const connectionEvents: string[] = [];
    const errorEvents: Error[] = [];

    planLlama.on("error", (error) => errorEvents.push(error));

    // Track connection state changes
    const originalEmit = mockSocket.emit;
    mockSocket.emit = jest.fn().mockImplementation((...args) => {
      if (args[0] === "connect") connectionEvents.push("connect");
      if (args[0] === "disconnect") connectionEvents.push("disconnect");
      return originalEmit.apply(mockSocket, args);
    });

    // Simulate connection loss
    mockSocket.mockDisconnect("io server disconnect");

    // Wait a bit for reconnection attempt
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate successful reconnection
    await mockSocket.mockConnect();

    // Wait for reconnection to complete
    await new Promise((resolve) => setImmediate(resolve));

    // Verify client handles reconnection
    expect(mockSocket.disconnected).toBe(false);
    expect(mockSocket.connected).toBe(true);
  });
});
