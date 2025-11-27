import { PlanLlama, StepResult } from '../src/client'

const jobName = `workflow3-${new Date().toLocaleDateString('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})}`
console.log(`Job name: ${jobName}`)

async function main() {
  const planLlama = new PlanLlama(process.env.PLANLLAMA_TOKEN || 'test-token')
  await planLlama.start()

  planLlama.workflow(jobName, {
    step1: async (results?: StepResult) => {
      console.log('Step 1 processing:', results)
      return 'step1'
    },
    step2: [
      'step1',
      async (results: StepResult) => {
        console.log('Step 2 processing:', results)
        return 'step2'
      },
    ],
    step3: [
      'step1',
      async (results: StepResult) => {
        console.log('Step 3 processing:', results)
        return 'step3'
      },
    ],
    step4: [
      'step2',
      'step3',
      async (results: StepResult) => {
        console.log('Step 4 processing:', results)
        // throw "Error in step 4";
        return 'step4'
      },
    ],
  })

  const startTime = process.hrtime.bigint()
  const result = await planLlama.request(jobName)
  const endTime = process.hrtime.bigint()
  const duration = Number(endTime - startTime) / 1e6

  console.log(`Result of processing: `, result)
  console.log(`Request took ${duration}ms (${(duration / 1000).toFixed(2)}s)`)
  // process.exit(0);
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
