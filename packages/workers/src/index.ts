/**
 * `@cc/workers` — the background layer (docs/DECISIONS.md ADR-022).
 *
 * Nothing imports from this package: the boundary rules give `workers` the
 * same "nothing may import it" treatment as `apps`, so queue work can never
 * creep back onto the request path. These exports exist for the process
 * entrypoint and the test suites.
 */
export {
  relayOnce,
  relayTenant,
  startRelayLoop,
  type RelayLoop,
  type RelayOptions,
  type RelayResult,
} from "./relay";

export {
  createBullPublisher,
  createQueues,
  createRedisConnection,
  type EventJob,
  type EventPublisher,
} from "./publisher";

export { createQueueWorker } from "./consumer";

export {
  startSlaSweepLoop,
  sweepSlaOnce,
  type SlaSweepLoop,
  type SlaSweepResult,
} from "./sla-sweep";

/**
 * The registry itself, not `./handlers` — importing that barrel registers
 * every handler as a side effect, which is what the worker entrypoint wants
 * and what a test importing this package emphatically does not.
 */
export {
  dispatchEvent,
  handlersFor,
  registerHandler,
  registeredQueues,
  resetHandlers,
  HandlerFailures,
  type EventHandler,
  type HandlerContext,
} from "./handlers/registry";

export { env, type WorkerEnv } from "./env";
