import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatSweepFailure, sweep } from "@cc/domain/authz-sweep";

/**
 * Authz route sweep for the operator console (doc 10 Phase 3).
 *
 * Previously written independently from apps/web's, on the reasoning that
 * the two realms were shaped differently enough — one permission registry
 * against one implicit role — that sharing would be more indirection than
 * it saved. The five-tier model removed that difference: the console now
 * has two roles and a permission per route, so both apps are asking the
 * identical question of the identical registry, and the shared engine in
 * `@cc/domain/authz-sweep` is now the smaller thing (superseding ADR-045's
 * tooling corollary, not its runtime reasoning — the realms still share no
 * token, cookie or error class).
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = sweep({ plane: "ops", appRoot: APP_ROOT });
const failure = formatSweepFailure(result);

console.log(`Authz sweep (ops): ${result.checked} route handlers checked against API_ROUTES.`);

if (failure) {
  console.error(`\n${failure}\n`);
  process.exitCode = 1;
} else {
  console.log("Every handler is declared in the registry and guards the permission it declares.");
}
