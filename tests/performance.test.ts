import type { Job } from "../src/client";
import { PlanLlama } from "../src/client";
import { mockSocket } from "./__mocks__/socket.io-client";

describe("PlanLlama Performance Tests", () => {
	let planLlama: PlanLlama;

	beforeEach(async () => {
		jest.clearAllMocks();
		mockSocket.removeAllListeners();
		mockSocket.connected = false;
		mockSocket.disconnected = true;

		planLlama = new PlanLlama("test-token");
		const connectPromise = planLlama.start();
		setTimeout(() => mockSocket.mockConnect(), 10);
		await connectPromise;
	});

	afterEach(async () => {
		await planLlama.stop();
	});

	it("should handle high-volume job sending efficiently", async () => {
		const jobCount = 1000;
		const sentJobs: string[] = [];

		// Mock server responses
		mockSocket.emit.mockImplementation((event, _data, callback) => {
			if (event === "send_job" && callback) {
				const jobId = `job-${sentJobs.length + 1}`;
				sentJobs.push(jobId);
				setTimeout(() => callback({ status: "ok", jobId }), 1);
			}
		});

		const startTime = Date.now();

		// Send jobs in parallel
		const sendPromises = Array.from({ length: jobCount }, (_, index) =>
			planLlama.publish("bulk-job", { index }),
		);

		const jobIds = await Promise.all(sendPromises);

		const endTime = Date.now();
		const duration = endTime - startTime;

		expect(jobIds).toHaveLength(jobCount);
		expect(sentJobs).toHaveLength(jobCount);

		// Should handle 1000 jobs in reasonable time (under 5 seconds)
		expect(duration).toBeLessThan(5000);

		// Should maintain good throughput (>200 jobs/second)
		const throughput = jobCount / (duration / 1000);
		expect(throughput).toBeGreaterThan(200);
	});

	it("should handle high-frequency work processing efficiently", async () => {
		const jobCount = 500;
		const processedJobs: string[] = [];
		const processingTimes: number[] = [];

		// Register fast processor
		planLlama.work("fast-job", async (job) => {
			const startTime = Date.now();

			// Minimal processing
			const result = { id: job.id, data: job.data };

			const endTime = Date.now();
			processingTimes.push(endTime - startTime);
			processedJobs.push(job.id);

			return result;
		});

		const overallStartTime = Date.now();

		// Simulate rapid work requests
		for (let i = 0; i < jobCount; i++) {
			const job: Job = {
				id: `fast-job-${i}`,
				name: "fast-job",
				data: { index: i },
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
				timeout: 1,
			};

			// Stagger slightly to avoid overwhelming
			setTimeout(() => mockSocket.mockServerEvent("work_request", job), i);
		}

		// Wait for all processing to complete
		await new Promise((resolve) => {
			const checkCompletion = () => {
				if (processedJobs.length === jobCount) {
					resolve(undefined);
				} else {
					setTimeout(checkCompletion, 10);
				}
			};
			checkCompletion();
		});

		const overallEndTime = Date.now();
		const totalDuration = overallEndTime - overallStartTime;

		expect(processedJobs).toHaveLength(jobCount);

		// Should process all jobs in reasonable time
		expect(totalDuration).toBeLessThan(10000);

		// Average processing time should be low
		const avgProcessingTime =
			processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
		expect(avgProcessingTime).toBeLessThan(50); // Under 50ms per job

		// Should maintain good processing throughput
		const processingThroughput = jobCount / (totalDuration / 1000);
		expect(processingThroughput).toBeGreaterThan(50);
	});

	it("should handle memory efficiently with large job data", async () => {
		const largeDataSize = 1024 * 1024; // 1MB
		const jobCount = 10;
		const processedJobs: string[] = [];

		// Register handler for large data
		planLlama.work("large-data-job", async (job) => {
			const { id, data } = job.data as { id: string; data: string };

			// Verify data integrity
			expect(data.length).toBe(largeDataSize);
			expect(data[0]).toBe("A");
			expect(data[data.length - 1]).toBe("Z");

			processedJobs.push(id);
			return { processed: true, size: data.length };
		});

		// Create large data payload
		const createLargeData = (id: string) => ({
			id,
			data: `${"A".repeat(largeDataSize - 1)}Z`,
		});

		const startTime = Date.now();

		// Send jobs with large data
		for (let i = 0; i < jobCount; i++) {
			const job: Job = {
				id: `large-job-${i}`,
				name: "large-data-job",
				data: createLargeData(`large-job-${i}`),
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
				timeout: 1,
			};

			setTimeout(
				() => mockSocket.mockServerEvent("work_request", job),
				i * 100,
			);
		}

		// Wait for processing
		await new Promise((resolve) => {
			const checkCompletion = () => {
				if (processedJobs.length === jobCount) {
					resolve(undefined);
				} else {
					setTimeout(checkCompletion, 100);
				}
			};
			checkCompletion();
		});

		const endTime = Date.now();
		const duration = endTime - startTime;

		expect(processedJobs).toHaveLength(jobCount);

		// Should handle large data efficiently
		expect(duration).toBeLessThan(5000);

		// Memory usage should remain reasonable (this is more of a smoke test)
		const usedMemory = process.memoryUsage().heapUsed;
		expect(usedMemory).toBeLessThan(100 * 1024 * 1024); // Under 100MB
	});

	it("should handle event listener performance efficiently", async () => {
		const eventCounts = {
			completed: 0,
			failed: 0,
			active: 0,
			retrying: 0,
		};

		// Add multiple event listeners
		const listenerCount = 10;
		for (let i = 0; i < listenerCount; i++) {
			planLlama.on("completed", () => eventCounts.completed++);
			planLlama.on("failed", () => eventCounts.failed++);
			planLlama.on("active", () => eventCounts.active++);
			planLlama.on("retrying", () => eventCounts.retrying++);
		}

		// Register job handlers
		planLlama.work("success-job", async () => ({ success: true }));
		planLlama.work("fail-job", async () => {
			throw new Error("Intentional failure");
		});

		const jobCount = 100;
		const startTime = Date.now();

		// Send mix of successful and failing jobs
		for (let i = 0; i < jobCount; i++) {
			const jobName = i % 2 === 0 ? "success-job" : "fail-job";
			const job: Job = {
				id: `event-job-${i}`,
				name: jobName,
				data: { index: i },
				state: "active",
				retryCount: 0,
				priority: 0,
				createdAt: new Date(),
				timeout: 5000,
			};

			setTimeout(() => mockSocket.mockServerEvent("work_request", job), i * 10);
		}

		// Wait for all events to be processed
		await new Promise((resolve) => setTimeout(resolve, 2000));

		const endTime = Date.now();
		const duration = endTime - startTime;

		// Verify event handling
		expect(eventCounts.active).toBe(jobCount * listenerCount);
		expect(eventCounts.completed).toBe((jobCount / 2) * listenerCount);
		expect(eventCounts.failed).toBe((jobCount / 2) * listenerCount);

		// Should handle events efficiently
		expect(duration).toBeLessThan(5000);

		// Event processing should not significantly impact performance
		const eventsPerSecond =
			(eventCounts.active + eventCounts.completed + eventCounts.failed) /
			(duration / 1000);
		expect(eventsPerSecond).toBeGreaterThan(100);
	});

	it("should handle concurrent connections efficiently", async () => {
		const connectionCount = 5;
		const planLlamas: PlanLlama[] = [];
		const connectTimes: number[] = [];

		try {
			// Create multiple connections
			for (let i = 0; i < connectionCount; i++) {
				const startTime = Date.now();
				const testPlanLlama = new PlanLlama(`test-token-${i}`);

				const connectPromise = testPlanLlama.start();
				setTimeout(() => mockSocket.mockConnect(), 10);
				await connectPromise;

				const endTime = Date.now();
				connectTimes.push(endTime - startTime);
				planLlamas.push(testPlanLlama);
			}

			// Verify all connections established quickly
			const avgConnectTime =
				connectTimes.reduce((a, b) => a + b, 0) / connectTimes.length;
			expect(avgConnectTime).toBeLessThan(100); // Under 100ms average

			// Test concurrent job sending
			const jobPromises = planLlamas.map((j, index) => {
				mockSocket.emit.mockImplementation((event, _data, callback) => {
					if (event === "send_job" && callback) {
						setTimeout(
							() => callback({ status: "ok", jobId: `concurrent-${index}` }),
							5,
						);
					}
				});

				return j.publish("concurrent-test", { index });
			});

			const jobIds = await Promise.all(jobPromises);
			expect(jobIds).toHaveLength(connectionCount);
		} finally {
			// Clean up connections
			await Promise.all(planLlamas.map((j) => j.stop()));
		}
	});
});
