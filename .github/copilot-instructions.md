# AI Assistant Instructions for PlanLlama

Concise, project-specific guidance for automated coding agents. Keep edits aligned with these conventions.

## 1. Project Purpose & High-Level Architecture
PlanLlama is a lightweight Node.js client library for a remote job scheduling/queueing service. It exposes a single public class `PlanLlama` (exported via `src/index.ts`) that:
- Manages a persistent Socket.IO connection to a server (`/ws` path) with auth via `apiToken`.
- Publishes jobs (`publish`, `request`, `publishBatch`) and schedules recurring jobs (`schedule`).
- Registers local workers (`work`) to process server-pushed jobs via `work_request` events.
- Provides job lifecycle helpers: `getJobById`, `cancel`, `getQueueSize`, `waitForBatch`, `getTemporaryToken`.
- Emits high-level events (`active`, `completed`, `failed`, `retrying`, `expired`, `cancelled`).

All networking is event-based; no REST layer. Protocol is defined in `PROTOCOL.md`. The client is intentionally state-light: server is source of truth. Avoid adding persistence or broad caching unless required.

## 2. Source Layout
- `src/client.ts`: Core implementation (nearly all logic). Treat as the public API surface except clearly private members.
- `src/index.ts`: Re-exports for package consumers.
- `tests/**`: Comprehensive behavioral, integration, performance, and edge-case coverage (use as executable spec). Mocks for Socket.IO in `tests/__mocks__/socket.io-client.ts`.
- `PROTOCOL.md`: Canonical event names, payload contracts—must stay in sync with code.

## 3. Public API & Stability
Methods on `PlanLlama` are considered public unless explicitly private. When modifying:
- Maintain backwards compatibility (parameter order, method names, event names).
- Prefer additive changes; if a breaking change is unavoidable, gate via new optional parameter keys instead of signature changes.
- Any new socket event -> update `PROTOCOL.md` + add tests mirroring existing style.

## 4. Socket / Event Handling Conventions
- Connection established in `start()`; resolves only after `client_ready` is received (see mock sequence in tests).
- Re-registration of workers on reconnect: logic keyed by `this.reconnecting` and `jobHandlers` map.
- For inbound `work_request`: Always emit `job_started` first, then on handler resolution emit `job_completed` (with `result`) or on failure callback with `{status: "error"}` and emit `failed`.
- Timeouts: A per-job timeout is enforced with `setTimeout` using `job.timeout` seconds; on expiry emit failure callback and `failed` event.
- Event emissions to library consumers use Node `EventEmitter` (`super.emit`). Do not leak raw socket events.

## 5. Job & Option Semantics
`JobOptions` in code differs slightly from README examples (README uses older field names like `expireIn` / `priority` only). Current canonical options include granular expiry/retention/singleton units (e.g. `expireInSeconds`, `retentionDays`, `singletonNextSlot`). Preserve existing names; add adapters only if strictly needed. Document any mapping in README if introducing normalization.

## 6. Testing Strategy (Follow This Style)
Use existing tests as specification:
- Unit & lifecycle: `client.test.ts`
- Edge resilience: `edge-cases.test.ts`
- Integration flows (retry, batch, concurrent workers): `integration.test.ts`
- Performance expectations (throughput, latency ceilings): `performance.test.ts`
Patterns:
- All socket interactions mocked via `mockSocket` (don’t import real socket.io-client in tests).
- Async flows resolved with `setImmediate` or small `setTimeout` to flush microtasks.
- When adding a feature, add: success path, error path, malformed response path.

## 7. Mock & Emission Patterns
`mockSocket.emit` is overloaded: treat listed client->server events as non-EventEmitter emissions (see `isClientServerEvent`). When adding a new client->server event, extend that allowlist in the mock OR tests will mis-route.

## 8. Build / Tooling
- TypeScript compiled with `tsc` (CommonJS output) via `npm run build`.
- Lint/format via Biome: `npm run lint` / `npm run lint:fix` (tabs, double quotes). Match style; do not reformat unrelated regions.
- Test commands:
  - `npm test` (default)
  - `npm run test:watch`
  - `npm run test:cov` (coverage HTML in `coverage/`)
- No bundler / tree-shaking complexity—keep imports explicit.

## 9. Adding Features Safely
When introducing a new capability:
1. Define protocol addition in `PROTOCOL.md` (event name + payload/response shape).
2. Add method to `PlanLlama` (mirror structure of existing promise wrappers). Always:
   - Guard `!this.isStarted || !this.socket` with uniform error message.
   - Wrap socket emit in a `new Promise` and validate `response.status` strictly.
3. Add tests covering ok + error + malformed response + disconnected state.
4. Update README usage examples only after tests pass.

## 10. Error Handling Expectations
- All async public methods reject with `Error` (never return sentinel values).
- Normalize unknown errors to `Error(message)` using `instanceof` checks like existing patterns.
- Timeouts and invalid responses use messages identical to existing code (e.g. "Invalid response from server"). Reuse to keep tests stable.

## 11. Performance & Concurrency
Performance tests assert throughput; avoid heavy synchronous work inside handlers or event loops. Non-blocking patterns only. If adding retries/backoff logic client-side, ensure it does not starve event loop (use timers, no while-loops).

## 12. Event Naming / Extensions
Maintain current naming scheme: server->client notifications prefixed with `job_` for state transitions; client->consumer events use past participle or gerund (`completed`, `retrying`). For new states, follow parallelism (`pausing` / `paused`, etc.) and ensure both socket and emitter sides are wired.

## 13. Documentation Sync Checklist (For Any Change)
- Public method or option added -> README + PROTOCOL + tests.
- New socket event -> PROTOCOL + mock allowlist + handler wiring + tests.
- Option rename (avoid) -> support legacy key temporarily and deprecate with comment.

## 14. Non-Goals / Avoid
- Do not introduce persistent storage, queues, or scheduling logic client-side.
- No global singletons; multiple `PlanLlama` instances are supported (see performance tests).
- Avoid silent failures—always surface errors via promise rejection or event.

## 15. Quick Reference: Core Methods Pattern
Example structure to imitate:
```ts
async someOp(arg: X): Promise<Y> {
  if (!this.isStarted || !this.socket) throw new Error("PlanLlama not started. Call start() first.");
  return new Promise((resolve, reject) => {
    this.socket!.emit("event_name", { arg }, (response: SocketResponse<Y>) => {
      if (response.status === "error") return reject(new Error(response.error));
      if (response.status === "ok" && response.expectedField) return resolve(response.expectedField);
      return reject(new Error("Invalid response from server"));
    });
  });
}
```

## 16. Open Gaps / Clarifications Needed
- Reconnection strategy currently minimal (commented logic). If enhancing, define deterministic backoff tests.
- README option names drift from code (`expireIn` vs granular units). Decide on normalization direction.
- `request()` method uses dynamic event names (`job_completed_<id>`); server-side contract assumed—ensure PROTOCOL includes if formalizing.

Provide feedback if any area needs deeper coverage or if planning a breaking change.
