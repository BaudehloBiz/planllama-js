import * as ProgressBar from "progress";
import { PlanLlama } from "../src/client";

const durationSeconds = parseInt(process.argv[2] || "10", 10);

const jobName = `remote-${new Date().toLocaleDateString("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})}`;
console.log(`Job name: ${jobName}`);

async function main() {
  const planLlama = new PlanLlama(process.env.PLANLLAMA_TOKEN || "test-token");
  await planLlama.start();

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
    bar.tick(1, { queued });
    if (bar.complete) {
      clearInterval(queueInterval);
    }
  }, 1000);

  while (elapsed < durationSeconds) {
    await planLlama.publish(jobName, { a: 1, b: 2 });
    queued++;
    const now = Date.now();
    elapsed = (now - startTime) / 1000;
  }
  clearInterval(queueInterval);
  bar.tick(durationSeconds - bar.curr, {});
  console.log(`\nAll jobs queued. Waiting for completion...`);

  console.log(`\nPerformance test complete.`);
  console.log(
    `Jobs queued per second: ${(queued / durationSeconds).toFixed(2)}`
  );
  console.log(`Remaining jobs: ${await planLlama.getQueueSize(jobName)}`);
  await planLlama.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
