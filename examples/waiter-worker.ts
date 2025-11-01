import { PlanLlama } from "../src/client";

const jobName = `waiter-${new Date().toLocaleDateString("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})}`;
console.log(`Job name: ${jobName}`);

async function main() {
  const planLlama = new PlanLlama(process.env.PLANLLAMA_TOKEN || "test-token");
  await planLlama.start();

  let count = 0;

  planLlama.work(jobName, async (job) => {
    const { a, b } = job.data as { a: number; b: number };
    console.log(`Processing job ${++count} with data: a=${a}, b=${b}`);
    throw new Error("Simulated failure");
    return a + b;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
