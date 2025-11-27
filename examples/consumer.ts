import { PlanLlama } from '../src/client'

const jobName = `remote-${new Date().toLocaleDateString('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})}`
console.log(`Job name: ${jobName}`)

async function main() {
  const planLlama = new PlanLlama(process.env.PLANLLAMA_TOKEN || 'test-token')
  await planLlama.start()

  planLlama.work(jobName, async (job) => {
    const { a, b } = job.data as { a: number; b: number }
    return a + b
  })

  while (true) {
    const qSize = await planLlama.getQueueSize(jobName)
    process.stdout.write(`\rWaiting for queue to drain... ${qSize} jobs remaining`)
    // if (qSize === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
