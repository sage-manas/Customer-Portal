/**
 * Importing this module registers every handler. The worker entrypoint
 * imports it once, before it starts listening — a queue that starts before
 * its handlers are registered treats real events as unhandled no-ops.
 *
 * Each Track A phase adds its handlers here: A3 consumes A2's POD
 * discrepancies, A7 consumes everything on the `notifications` queue.
 */
import "./payment-posting";
import "./support-auto-ticket";

export {
  dispatchEvent,
  handlersFor,
  registerHandler,
  registeredQueues,
  resetHandlers,
  HandlerFailures,
  type EventHandler,
  type HandlerContext,
} from "./registry";
