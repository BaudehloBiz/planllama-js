# Jobber Socket.IO Protocol

This document describes the socket.io protocol used by the Jobber client to communicate with the Jobber server.

## Connection

The client connects to the server using socket.io with WebSocket transport:

```typescript
const socket = io(serverUrl, {
  auth: {
    customerToken: "your-token-here",
  },
  transports: ["websocket"],
});
```

## Authentication

Authentication is handled via the `customerToken` passed in the `auth` object during connection.

## Client-to-Server Events

### `send_job`

Send a job to be processed immediately or at a scheduled time.

**Payload:**

```typescript
{
  name: string;
  data: any;
  options?: JobOptions;
}
```

**Response:**

```typescript
{
  jobId?: string;
  error?: string;
}
```

### `schedule_job`

Schedule a recurring job using cron pattern.

**Payload:**

```typescript
{
  name: string;
  cronPattern: string;
  data: any;
  options?: JobOptions;
}
```

**Response:**

```typescript
{
  scheduleId?: string;
  error?: string;
}
```

### `register_worker`

Register a worker to handle specific job types.

**Payload:**

```typescript
{
  jobName: string;
  options?: WorkOptions;
}
```

### `send_batch`

Send multiple jobs as a batch.

**Payload:**

```typescript
{
  jobs: BatchJob[];
}
```

**Response:**

```typescript
{
  batchId?: string;
  error?: string;
}
```

### `wait_for_batch`

Wait for a batch to complete.

**Payload:**

```typescript
{
  batchId: string;
}
```

**Response:**

```typescript
{
  error?: string;
}
```

### `get_job`

Get job details by ID.

**Payload:**

```typescript
{
  jobId: string;
}
```

**Response:**

```typescript
{
  job?: Job;
  error?: string;
}
```

### `cancel_job`

Cancel a job.

**Payload:**

```typescript
{
  jobId: string;
}
```

**Response:**

```typescript
{
  error?: string;
}
```

### `get_queue_size`

Get queue statistics.

**Payload:**

```typescript
{
}
```

**Response:**

```typescript
{
  queueSize?: QueueSize;
  error?: string;
}
```

### `job_started`

Acknowledge that a job has started processing.

**Payload:**

```typescript
{
  jobId: string;
}
```

### `job_completed`

Report that a job has completed successfully.

**Payload:**

```typescript
{
  jobId: string;
  result?: any;
}
```

### `job_failed`

Report that a job has failed.

**Payload:**

```typescript
{
  jobId: string;
  error: string;
}
```

## Server-to-Client Events

### `work_request`

Server sends a job to the client for processing.

**Payload:**

```typescript
Job;
```

### `job_retrying`

Server notifies that a job is being retried.

**Payload:**

```typescript
Job;
```

### `job_expired`

Server notifies that a job has expired.

**Payload:**

```typescript
Job;
```

### `job_cancelled`

Server notifies that a job has been cancelled.

**Payload:**

```typescript
Job;
```

## Data Types

### Job

```typescript
interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  state:
    | "created"
    | "retry"
    | "active"
    | "completed"
    | "expired"
    | "cancelled"
    | "failed";
  retryCount: number;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
}
```

### JobOptions

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

### WorkOptions

```typescript
interface WorkOptions {
  teamSize?: number;
  teamConcurrency?: number;
}
```

### QueueSize

```typescript
interface QueueSize {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}
```

### BatchJob

```typescript
interface BatchJob<T = unknown> {
  name: string;
  data: T;
  options?: JobOptions;
}
```

## Error Handling

All server responses include an optional `error` field. If present, it contains a human-readable error message. Common error codes that might be included:

- `INVALID_TOKEN`: The customer token is invalid
- `RATE_LIMIT_EXCEEDED`: Rate limit has been exceeded
- `JOB_NOT_FOUND`: Requested job ID does not exist
- `BATCH_NOT_FOUND`: Requested batch ID does not exist
- `INVALID_CRON_PATTERN`: The cron pattern is invalid

## Connection Events

The client also handles standard socket.io connection events:

- `connect`: Successfully connected to server
- `disconnect`: Disconnected from server
- `connect_error`: Failed to connect to server
- `error`: General socket error

## Reconnection

The client automatically handles reconnection with exponential backoff up to a maximum of 10 attempts.
