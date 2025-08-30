import { Jobber } from "./client";

// Example usage of the Jobber client
async function main() {
	// Initialize Jobber with customer token
	const jobber = new Jobber("your-customer-token-here");

	// Set up event listeners
	jobber.on("completed", (job, result) => {
		console.log(`Job ${job.id} completed with result:`, result);
	});

	jobber.on("failed", (job, error) => {
		console.error(`Job ${job.id} failed:`, error);
	});

	jobber.on("retrying", (job) => {
		console.log(`Retrying job ${job.id}, attempt ${job.retryCount + 1}`);
	});

	try {
		// Start the connection to the server
		await jobber.start();

		// Register job handlers
		jobber.work("send-email", async (job) => {
			const { to, subject } = job.data as {
				to: string;
				subject: string;
				body: string;
			};

			// Simulate email sending
			console.log(`Sending email to ${to}: ${subject}`);
			await new Promise((resolve) => setTimeout(resolve, 1000));

			return { success: true, messageId: "msg-123" };
		});

		jobber.work(
			"process-payment",
			{
				teamSize: 3,
				teamConcurrency: 2,
			},
			async (job) => {
				const { userId, amount, currency } = job.data as {
					userId: number;
					amount: number;
					currency: string;
				};

				// Simulate payment processing
				console.log(
					`Processing payment: $${amount} ${currency} for user ${userId}`,
				);
				await new Promise((resolve) => setTimeout(resolve, 2000));

				return {
					success: true,
					transactionId: `txn-${Date.now()}`,
					amount,
					currency,
				};
			},
		);

		// Send some jobs
		const emailJobId = await jobber.send("send-email", {
			to: "user@example.com",
			subject: "Welcome!",
			body: "Thanks for signing up!",
		});
		console.log("Email job sent:", emailJobId);

		// Send a payment job with retry options
		const paymentJobId = await jobber.send(
			"process-payment",
			{
				userId: 123,
				amount: 29.99,
				currency: "USD",
			},
			{
				retryLimit: 3,
				retryDelay: 30,
				priority: 10,
			},
		);
		console.log("Payment job sent:", paymentJobId);

		// Schedule a recurring job
		const scheduleId = await jobber.schedule("daily-report", "0 9 * * *", {
			reportType: "daily",
			recipients: ["admin@example.com"],
		});
		console.log("Daily report scheduled:", scheduleId);

		// Send a batch of jobs
		const batchId = await jobber.sendBatch([
			{
				name: "send-email",
				data: { to: "user1@example.com", subject: "Hello", body: "Message 1" },
			},
			{
				name: "send-email",
				data: { to: "user2@example.com", subject: "Hello", body: "Message 2" },
			},
			{
				name: "send-email",
				data: { to: "user3@example.com", subject: "Hello", body: "Message 3" },
			},
		]);
		console.log("Batch sent:", batchId);

		// Get queue statistics
		const queueSize = await jobber.getQueueSize("send-email");
		console.log("Queue size:", queueSize);

		// Wait a bit for jobs to process
		await new Promise((resolve) => setTimeout(resolve, 5000));

		// Get job details
		const emailJob = await jobber.getJobById(emailJobId);
		console.log("Email job status:", emailJob?.state);
	} catch (error) {
		console.error("Error:", error);
	}

	// Graceful shutdown
	process.on("SIGINT", async () => {
		console.log("Shutting down...");
		await jobber.stop();
		process.exit(0);
	});
}

// Run the example
if (require.main === module) {
	main().catch(console.error);
}
