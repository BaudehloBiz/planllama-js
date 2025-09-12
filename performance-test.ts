import { randomUUID } from "node:crypto";
import ProgressBar from "progress";
import { PlanLlama } from "./src/client";

const durationSeconds = parseInt(process.argv[2] || '10', 10);

async function main() {
	const planLlama = new PlanLlama("your-customer-token-here");
	let completed = 0;
	let failed = 0;

	planLlama.on("completed", () => {
		completed++;
	});
	planLlama.on("failed", () => {
		failed++;
	});

	await planLlama.start();

		const jobName = `add-${randomUUID()}`;
		planLlama.work(jobName, async (job) => {
			const { a, b } = job.data as { a: number; b: number };
			return a + b;
		});

		const bar = new ProgressBar("Queuing [:bar] :percent Queued: :queued", {
			total: durationSeconds,
			width: 40,
		});

		console.log(`Queuing jobs for ${durationSeconds} seconds...`);
		let queued = 0;
		const startTime = Date.now();
		let elapsed = 0;

		const queueInterval = setInterval(() => {
			const now = Date.now();
			elapsed = (now - startTime) / 1000;
			bar.tick(1, {queued});
			if (bar.complete) {
					clearInterval(queueInterval);
			}
		}, 1000);

		while (elapsed < durationSeconds) {
			await planLlama.send(jobName, { a: 1, b: 2 });
			queued++;
		  const now = Date.now();
			elapsed = (now - startTime) / 1000;
		}
		clearInterval(queueInterval);
		bar.tick(durationSeconds - bar.curr, {});
		console.log(`\nAll jobs queued. Waiting for completion...`);

		while (completed + failed < queued) {
			process.stdout.write(`\rCompleted: ${completed} / ${queued}`);
			await new Promise((r) => setTimeout(r, 500));
		}
		const endTime = Date.now();
		const totalElapsed = (endTime - startTime) / 1000;
		console.log(`\nPerformance test complete.`);
		console.log(`Jobs queued per second: ${(queued / durationSeconds).toFixed(2)}`);
		console.log(`Jobs worked per second: ${(queued / totalElapsed).toFixed(2)}`);
    console.log(`Remaining jobs: ${await planLlama.getQueueSize(jobName)}`);
		await planLlama.stop();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
