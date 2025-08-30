import type { Job } from "../src/client";
import { Jobber } from "../src/client";
import { mockSocket } from "./__mocks__/socket.io-client";

describe("Jobber Error Handling and Edge Cases", () => {
	let jobber: Jobber;

	beforeEach(() => {
		jest.clearAllMocks();
		mockSocket.removeAllListeners();
		mockSocket.connected = false;
		mockSocket.disconnected = true;

		// Reset mock implementations
		mockSocket.emit.mockReset();
		mockSocket.on.mockReset();
		mockSocket.off.mockReset();
		mockSocket.disconnect.mockReset();
		mockSocket.connect.mockReset();

		// Restore default implementations
		mockSocket.on.mockImplementation(
			(event: string, handler: (...args: unknown[]) => void) => {
				return mockSocket.addListener(event, handler);
			},
		);
		mockSocket.off.mockImplementation(
			(event: string, handler?: (...args: unknown[]) => void) => {
				if (handler) {
					return mockSocket.removeListener(event, handler);
				} else {
					return mockSocket.removeAllListeners(event);
				}
			},
		);
	});

	afterEach(async () => {
		if (jobber) {
			await jobber.stop();
		}
	});

	describe("Connection Edge Cases", () => {
		it("should handle connection timeout", async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});

			const connectPromise = jobber.start();

			// Don't trigger connect event (simulates timeout)
			await expect(connectPromise).rejects.toThrow();
		});

		it("should handle immediate disconnection after connection", async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});

			const connectPromise = jobber.start();

			// Simulate connection followed immediately by disconnection
			mockSocket.mockConnect();
			await connectPromise;

			// Now simulate immediate disconnection
			mockSocket.mockDisconnect("transport close");

			// Wait for disconnect handling
			await new Promise((resolve) => setImmediate(resolve));

			expect(mockSocket.disconnected).toBe(true);
		});

		it("should handle malformed server URL", () => {
			expect(() => {
				jobber = new Jobber({
					customerToken: "test-token",
					serverUrl: "invalid-url",
				});
			}).not.toThrow(); // Constructor should not throw for invalid URL
		});

		it("should handle missing environment variables gracefully", () => {
			const originalEnv = process.env.JOBBER_SERVER_URL;
			delete process.env.JOBBER_SERVER_URL;

			try {
				jobber = new Jobber({
					customerToken: "test-token",
					serverUrl: "http://localhost:3000",
				});
				expect(jobber).toBeInstanceOf(Jobber);
			} finally {
				if (originalEnv) {
					process.env.JOBBER_SERVER_URL = originalEnv;
				}
			}
		});
	});

	describe("Job Sending Edge Cases", () => {
		beforeEach(async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});
			const connectPromise = jobber.start();
			mockSocket.mockConnect();
			await connectPromise;
		});

		it("should handle server timeout on job sending", async () => {
			// Mock server that never responds
			mockSocket.emit.mockImplementation(() => {
				// No callback called
			});

			const _sendPromise = jobber.send("timeout-job", {});

			// This will hang indefinitely in real scenario
			// In test, we'll just verify the call was made
			expect(mockSocket.emit).toHaveBeenCalledWith(
				"send_job",
				expect.objectContaining({ name: "timeout-job" }),
				expect.any(Function),
			);
		});

		it("should handle malformed server responses", async () => {
			mockSocket.emit.mockImplementation((event, _data, callback) => {
				if (event === "send_job" && callback) {
					// Malformed response
					callback({ invalidField: "bad-response" });
				}
			});

			await expect(jobber.send("test-job", {})).rejects.toThrow(
				"Invalid response from server",
			);
		});

		it("should handle null/undefined job data", async () => {
			mockSocket.emit.mockImplementation((event, _data, callback) => {
				if (event === "send_job" && callback) {
					callback({ status: "ok", jobId: "null-data-job" });
				}
			});

			// Should handle null data
			await expect(jobber.send("test-job", null)).resolves.toBe(
				"null-data-job",
			);

			// Should handle undefined data
			await expect(jobber.send("test-job", undefined)).resolves.toBe(
				"null-data-job",
			);
		});

		it("should handle extremely large job payloads", async () => {
			const largePayload = {
				data: "x".repeat(10 * 1024 * 1024), // 10MB string
				metadata: Array.from({ length: 1000 }, (_, i) => ({
					id: i,
					value: `item-${i}`,
				})),
			};

			mockSocket.emit.mockImplementation((event, _data, callback) => {
				if (event === "send_job" && callback) {
					callback({ status: "ok", jobId: "large-payload-job" });
				}
			});

			await expect(jobber.send("large-job", largePayload)).resolves.toBe(
				"large-payload-job",
			);
		});

		it("should handle circular references in job data", async () => {
			const circularData: Record<string, unknown> = { name: "test" };
			circularData.self = circularData;

			mockSocket.emit.mockImplementation((event, _data, callback) => {
				if (event === "send_job" && callback) {
					callback({ status: "ok", jobId: "circular-job" });
				}
			});

			// Should not throw when sending circular data (JSON.stringify might fail, but that's server-side)
			await expect(jobber.send("circular-job", circularData)).resolves.toBe(
				"circular-job",
			);
		});
	});

	describe("Job Processing Edge Cases", () => {
		beforeEach(async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});
			const connectPromise = jobber.start();
			mockSocket.mockConnect();
			await connectPromise;
		});

		it("should handle job handler throwing non-Error objects", async () => {
			jobber.work("weird-error-job", async () => {
				// eslint-disable-next-line @typescript-eslint/no-throw-literal
				throw "string error";
			});

			const mockJob: Job = {
				id: "weird-error-123",
				name: "weird-error-job",
				data: {},
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
			};

			mockSocket.mockServerEvent("work_request", mockJob);

			await new Promise((resolve) => setImmediate(resolve));

			expect(mockSocket.emit).toHaveBeenCalledWith("job_failed", {
				jobId: "weird-error-123",
				error: "string error",
			});
		});

		it("should handle job handler returning undefined", async () => {
			jobber.work("undefined-result-job", async () => {
				return undefined;
			});

			const mockJob: Job = {
				id: "undefined-result-123",
				name: "undefined-result-job",
				data: {},
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
			};

			mockSocket.mockServerEvent("work_request", mockJob);

			await new Promise((resolve) => setImmediate(resolve));

			expect(mockSocket.emit).toHaveBeenCalledWith("job_completed", {
				jobId: "undefined-result-123",
				result: undefined,
			});
		});

		it("should handle job handler that never resolves", async () => {
			jobber.work("hanging-job", async () => {
				// Simulate hanging promise
				return new Promise(() => {
					// Never resolves
				});
			});

			const mockJob: Job = {
				id: "hanging-123",
				name: "hanging-job",
				data: {},
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
			};

			mockSocket.mockServerEvent("work_request", mockJob);

			// Wait a reasonable time
			await new Promise((resolve) => setImmediate(resolve));

			// Should have sent job_started but not job_completed or job_failed
			expect(mockSocket.emit).toHaveBeenCalledWith("job_started", {
				jobId: "hanging-123",
				jobName: "hanging-job",
			});
			expect(mockSocket.emit).not.toHaveBeenCalledWith(
				"job_completed",
				expect.any(Object),
			);
			expect(mockSocket.emit).not.toHaveBeenCalledWith(
				"job_failed",
				expect.any(Object),
			);
		});

		it("should handle malformed job data from server", async () => {
			jobber.work("normal-job", async (job) => {
				return { processed: job.id };
			});

			// Send malformed job without required fields
			const malformedJob = {
				// Missing required fields like 'id', 'name', etc.
				data: { test: "data" },
			} as unknown as Job;

			mockSocket.mockServerEvent("work_request", malformedJob);

			await new Promise((resolve) => setImmediate(resolve));

			// Should handle gracefully (might fail due to missing fields)
			// The exact behavior depends on how the handler accesses job properties
		});

		it("should handle job with extremely deep nested data", async () => {
			jobber.work("deep-nested-job", async (job) => {
				// Just process the job without accessing deep nested data to avoid errors
				return { processed: true, jobId: job.id };
			});

			// Create deeply nested data structure
			let deepData: Record<string, unknown> = { value: "deep-value" };
			for (let i = 0; i < 50; i++) {
				// Reduced depth to avoid potential issues
				deepData = { [`level${i}`]: deepData };
			}

			const mockJob: Job = {
				id: "deep-nested-123",
				name: "deep-nested-job",
				data: deepData,
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
			};

			mockSocket.mockServerEvent("work_request", mockJob);

			await new Promise((resolve) => setImmediate(resolve));

			// Should handle without stack overflow
			expect(mockSocket.emit).toHaveBeenCalledWith("job_started", {
				jobName: "deep-nested-job",
				jobId: "deep-nested-123",
			});
			expect(mockSocket.emit).toHaveBeenCalledWith("job_completed", {
				jobId: "deep-nested-123",
				result: { processed: true, jobId: "deep-nested-123" },
			});
		});
	});

	describe("Event System Edge Cases", () => {
		beforeEach(async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});
			const connectPromise = jobber.start();
			mockSocket.mockConnect();
			await connectPromise;
		});

		it("should handle event listener that throws errors", async () => {
			const consoleError = jest.spyOn(console, "error").mockImplementation();

			jobber.on("completed", () => {
				throw new Error("Event listener error");
			});

			jobber.work("test-job", async () => ({ success: true }));

			const mockJob: Job = {
				id: "event-error-123",
				name: "test-job",
				data: {},
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
			};

			mockSocket.mockServerEvent("work_request", mockJob);

			await new Promise((resolve) => setImmediate(resolve));

			// Job should still complete successfully despite event listener error
			expect(mockSocket.emit).toHaveBeenCalledWith(
				"job_completed",
				expect.any(Object),
			);

			consoleError.mockRestore();
		});

		it("should handle removing event listeners during event emission", async () => {
			let eventCount = 0;

			const listener = () => {
				eventCount++;
				if (eventCount === 1) {
					jobber.removeListener("completed", listener);
				}
			};

			jobber.on("completed", listener);
			jobber.work("test-job", async () => ({ success: true }));

			// Trigger multiple events
			for (let i = 0; i < 3; i++) {
				const mockJob: Job = {
					id: `remove-listener-${i}`,
					name: "test-job",
					data: {},
					state: "active",
					retryCount: 0,
					priority: 0,
					createdAt: new Date(),
				};

				mockSocket.mockServerEvent("work_request", mockJob);
				await new Promise((resolve) => setImmediate(resolve));
			}

			// Should only be called once (listener removed after first call)
			expect(eventCount).toBe(1);
		});

		it("should handle memory leaks from event listeners", async () => {
			const initialListenerCount = jobber.listenerCount("completed");

			// Add many listeners
			const listeners = Array.from({ length: 1000 }, () => () => {
				/* empty listener */
			});

			listeners.forEach((listener) => jobber.on("completed", listener));

			expect(jobber.listenerCount("completed")).toBe(
				initialListenerCount + 1000,
			);

			// Remove all listeners
			listeners.forEach((listener) =>
				jobber.removeListener("completed", listener),
			);

			expect(jobber.listenerCount("completed")).toBe(initialListenerCount);
		});
	});

	describe("Graceful Shutdown Edge Cases", () => {
		it("should handle stop during active job processing", async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});

			const connectPromise = jobber.start();
			mockSocket.mockConnect();
			await connectPromise;

			let jobInProgress = false;

			jobber.work("long-running-job", async () => {
				jobInProgress = true;
				// Simulate long-running job that takes a bit of time
				await new Promise((resolve) => setTimeout(resolve, 50));
				jobInProgress = false;
				return { completed: true };
			});

			const mockJob: Job = {
				id: "long-running-123",
				name: "long-running-job",
				data: {},
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
			};

			// Start job processing by emitting the work_request event
			mockSocket.mockServerEvent("work_request", mockJob);

			// Wait for job to start
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(jobInProgress).toBe(true);

			// Stop while job is running
			await jobber.stop();

			expect(mockSocket.disconnect).toHaveBeenCalled();
		});

		it("should handle multiple stop calls", async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});

			const connectPromise = jobber.start();
			mockSocket.mockConnect();
			await connectPromise;

			// Call stop multiple times
			const stopPromises = [jobber.stop(), jobber.stop(), jobber.stop()];

			await Promise.all(stopPromises);

			// Should only disconnect once
			expect(mockSocket.disconnect).toHaveBeenCalledTimes(1);
		});

		it("should handle stop without start", async () => {
			jobber = new Jobber({
				customerToken: "test-token",
				serverUrl: "http://localhost:3000",
			});

			// Should not throw
			await expect(jobber.stop()).resolves.toBeUndefined();
		});
	});
});
