/**
 * Importing this module registers every handler. The worker entrypoint
 * imports it once, before it starts listening — a queue that starts before
 * its handlers are registered treats real events as unhandled no-ops.
 *
 * Each Track A phase adds its handlers here: A3 consumes A2's POD
 * discrepancies, and A7's fan-out subscribes itself to every event the
 * `@cc/domain` notification registry has a template for — which is most of
 * the `notifications` queue plus two on `workflow`.
 */
import "./payment-posting";
import "./support-auto-ticket";
import "./notification-fanout";

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
