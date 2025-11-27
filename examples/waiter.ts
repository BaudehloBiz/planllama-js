import { PlanLlama } from '../src/client'

const jobName = `waiter-${new Date().toLocaleDateString('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})}`
console.log(`Job name: ${jobName}`)

async function main() {
  const planLlama = new PlanLlama(process.env.PLANLLAMA_TOKEN || 'test-token')
  await planLlama.start()

  const data = { a: Math.random(), b: Math.random() }
  const result = await planLlama.request(jobName, data)
  console.log(`Result of processing ${JSON.stringify(data)}: ${result}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
