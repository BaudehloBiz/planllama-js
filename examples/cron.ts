import { PlanLlama } from "../src/client";

async function main() {
  const planLlama = new PlanLlama(process.env.PLANLLAMA_TOKEN || "test-token");
  await planLlama.start();

  planLlama.work("wibble", async (job) => {
    console.log("Processing cron job with data:", job.data);
    return `Processed data: ${JSON.stringify(job)}`;
  });

  planLlama.schedule("wibble", "* * * * *", { foo: "bar" });
  // process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
