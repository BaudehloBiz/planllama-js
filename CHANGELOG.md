# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-11-17

### Added
- Initial release of PlanLlama job scheduler client
- Socket.IO-based real-time connection to PlanLlama service
- Job publishing with `publish()` and `request()` methods
- Job scheduling with cron expressions via `schedule()`
- Worker registration with `work()` for processing jobs
- Batch job operations with `publishBatch()` and `waitForBatch()`
- Job lifecycle management: `getJobById()`, `cancel()`, `getQueueSize()`
- Temporary browser token generation with `getTemporaryToken()`
- Event-based job status notifications: `active`, `completed`, `failed`, `retrying`, `expired`, `cancelled`
- Comprehensive job options: priority, delays, retries, expiration, singleton keys
- Full TypeScript support with type definitions
- Browser and Node.js compatibility
- Automatic reconnection handling
- Worker re-registration on reconnect

### Features
- **Dual module support**: CommonJS and ES Modules
- **Type-safe**: Full TypeScript definitions included
- **Real-time**: WebSocket-based communication via Socket.IO
- **Flexible**: Supports immediate, delayed, scheduled, and recurring jobs
- **Reliable**: Built-in retry logic and error handling
- **Scalable**: Worker pool management with team size and concurrency options

[1.0.0]: https://github.com/BaudehloBiz/planllama-js/releases/tag/v1.0.0
