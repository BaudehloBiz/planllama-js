# PlanLlama

A simple and powerful job scheduler for Node.js applications. PlanLlama provides a clean API for scheduling and managing background jobs without requiring a database connection - just an API key.

## Installation

```bash
npm install planLlama
```

## Quick Start

```typescript
import { PlanLlama } from "planLlama";

// Initialize with your customer token
const planLlama = new PlanLlama("your-customer-token");

// Start the job scheduler
await planLlama.start();

// Schedule a job
await planLlama.send("send-email", {
  to: "user@example.com",
  subject: "Welcome!",
  body: "Thanks for signing up!",
});
```

## Configuration

### Basic Setup

```typescript
import { PlanLlama } from "planLlama";

// Option 1: Initialize with token string
const planLlama = new PlanLlama("your-customer-token");

// Option 2: Initialize with options object
const planLlama = new PlanLlama({
  customerToken: "your-customer-token",
  // Additional options can be added here
});
```

## Scheduling Jobs

### Immediate Jobs

```typescript
// Send a job to be processed immediately
await planLlama.send("process-payment", {
  userId: 123,
  amount: 29.99,
  currency: "USD",
});
```

### Delayed Jobs

```typescript
// Schedule a job to run in 5 minutes
await planLlama.send(
  "reminder-email",
  { userId: 123, message: "Don't forget!" },
  { startAfter: new Date(Date.now() + 5 * 60 * 1000) }
);

// Schedule a job to run in 1 hour
await planLlama.send(
  "cleanup-temp-files",
  { directory: "/tmp/uploads" },
  { startAfter: "1 hour" }
);
```

### Recurring Jobs

```typescript
// Run every 15 minutes
await planLlama.schedule("health-check", "*/15 * * * *", {
  endpoint: "https://api.example.com/health",
});

// Run daily at 2 AM
await planLlama.schedule("daily-report", "0 2 * * *", {
  reportType: "daily",
  recipients: ["admin@example.com"],
});

// Run every Monday at 9 AM
await planLlama.schedule("weekly-summary", "0 9 * * 1", {
  type: "weekly",
});
```

## Job Handlers

Register handlers to process your jobs:

```typescript
// Register a job handler
planLlama.work("send-email", async (job) => {
  const { to, subject, body } = job.data;

  try {
    await emailService.send({ to, subject, body });
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error("Failed to send email:", error);
    throw error; // Job will be retried
  }
});

// Handler with options
planLlama.work(
  "process-payment",
  {
    teamSize: 5, // Process up to 5 jobs concurrently
    teamConcurrency: 2, // Each worker processes 2 jobs at a time
  },
  async (job) => {
    const { userId, amount, currency } = job.data;

    const result = await paymentProcessor.charge({
      userId,
      amount,
      currency,
    });

    return result;
  }
);
```

## Job Options

### Retry Configuration

```typescript
await planLlama.send(
  "flaky-api-call",
  { url: "https://api.unreliable.com/data" },
  {
    retryLimit: 5,
    retryDelay: 30, // seconds
    retryBackoff: true, // exponential backoff
  }
);
```

### Job Expiration

```typescript
await planLlama.send(
  "time-sensitive-task",
  { data: "important" },
  {
    expireIn: "5 minutes", // Job expires if not processed within 5 minutes
  }
);
```

### Job Priority

```typescript
// High priority job (processed first)
await planLlama.send(
  "urgent-notification",
  { message: "System alert!" },
  { priority: 10 }
);

// Low priority job
await planLlama.send("cleanup-logs", { olderThan: "30 days" }, { priority: -10 });
```

## Monitoring Jobs

### Job Events

```typescript
// Listen for job completion
planLlama.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

// Listen for job failures
planLlama.on("failed", (job, error) => {
  console.log(`Job ${job.id} failed:`, error.message);
});

// Listen for job retries
planLlama.on("retrying", (job) => {
  console.log(`Retrying job ${job.id}, attempt ${job.retryCount + 1}`);
});
```

### Getting Job Status

```typescript
// Get job by ID
const job = await planLlama.getJobById("job-id-123");
console.log(job.state); // 'created', 'retry', 'active', 'completed', 'expired', 'cancelled', 'failed'

// Cancel a job
await planLlama.cancel("job-id-123");

// Get job counts
const counts = await planLlama.getQueueSize();
console.log(counts); // { waiting: 5, active: 2, completed: 100, failed: 3 }
```

## Advanced Usage

### Job Batches

```typescript
// Process multiple related jobs as a batch
const batchId = await planLlama.sendBatch([
  { name: "resize-image", data: { imageId: 1, size: "thumbnail" } },
  { name: "resize-image", data: { imageId: 1, size: "medium" } },
  { name: "resize-image", data: { imageId: 1, size: "large" } },
]);

// Wait for entire batch to complete
await planLlama.waitForBatch(batchId);
```

### Custom Job IDs

```typescript
// Use custom job ID to prevent duplicates
await planLlama.send(
  "user-welcome-email",
  { userId: 123 },
  {
    id: `welcome-email-user-123`,
    singletonKey: "user-123", // Prevents duplicate jobs for same user
  }
);
```

## Error Handling

```typescript
try {
  await planLlama.send("risky-operation", { data: "test" });
} catch (error) {
  if (error.code === "RATE_LIMIT_EXCEEDED") {
    console.log("Rate limit exceeded, try again later");
  } else if (error.code === "INVALID_TOKEN") {
    console.log("Invalid customer token");
  } else {
    console.log("Unexpected error:", error.message);
  }
}
```

## Graceful Shutdown

```typescript
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await planLlama.stop();
  process.exit(0);
});
```

## API Reference

### Constructor Options

```typescript
interface CustomerOptions {
  customerToken: string;
  // Additional configuration options
}
```

### Job Options

```typescript
interface JobOptions {
  id?: string;
  priority?: number;
  startAfter?: Date | string;
  expireIn?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  singletonKey?: string;
}
```

### Work Options

```typescript
interface WorkOptions {
  teamSize?: number;
  teamConcurrency?: number;
}
```

## Examples

Check out the [examples directory](./examples) for more detailed usage examples:

- [Basic job processing](./examples/basic.js)
- [Email queue](./examples/email-queue.js)
- [Cron jobs](./examples/cron-jobs.js)
- [Image processing pipeline](./examples/image-processing.js)

## Support

- Documentation: [docs.planLlama.dev](https://docs.planLlama.dev)
- Issues: [GitHub Issues](https://github.com/your-org/planLlama/issues)
- Community: [Discord](https://discord.gg/planLlama)

## License

MIT
