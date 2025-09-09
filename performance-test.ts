import { randomUUID } from "node:crypto";
import * as ProgressBar from "progress";
import { Jobber } from "./src/client";

const durationSeconds = parseInt(process.argv[2] || '10', 10);
const tasksPerSecond = 1000;
const totalTasks = durationSeconds * tasksPerSecond;

async function main() {
	const jobber = new Jobber("your-customer-token-here");
	let completed = 0;
	let failed = 0;

	jobber.on("completed", () => {
		completed++;
	});
	jobber.on("failed", () => {
		failed++;
	});

	await jobber.start();

		const jobName = `add-${randomUUID()}`;
		jobber.work(jobName, async (job) => {
			const { a, b } = job.data as { a: number; b: number };
			return a + b;
		});

		const bar = new ProgressBar("Queuing [:bar] :percent :current", {
			total: durationSeconds,
			width: 40,
		});

		console.log(`Queuing jobs for ${durationSeconds} seconds...`);
		let queued = 0;
		let lastQueued = 0;
		const startTime = Date.now();
		let elapsed = 0;

		const queueInterval = setInterval(() => {
			const now = Date.now();
			elapsed = (now - startTime) / 1000;
			bar.tick(0, {});
			process.stdout.write(`\rQueued: ${queued} jobs in ${elapsed.toFixed(1)}s`);
			lastQueued = queued;
		}, 1000);

		while (elapsed < durationSeconds) {
			await jobber.send(jobName, { a: 1, b: 2 });
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
    console.log(`Remaining jobs: ${await jobber.getQueueSize(jobName)}`);
		await jobber.stop();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
