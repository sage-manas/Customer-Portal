import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatSweepFailure, sweep } from "@cc/domain/authz-sweep";

/**
 * Authz route sweep for the portal (doc 10 Phase 3).
 *
 * The checks themselves live in `@cc/domain/authz-sweep`, beside the
 * registry they compare the filesystem against — apps/ops runs the same
 * engine over its own tree, and two copies of these rules is precisely the
 * drift this phase exists to remove. This file is the app-specific half:
 * where the routes are, and which plane they belong to.
 *
 * Deliberately scoped to `app/api/**` and not `app/**` pages: a page
 * redirect on a missing permission is UX, and CLAUDE.md rule 5 is explicit
 * that the API is what enforces. A page with no guard behind a properly
 * guarded API is a UX bug, not an authz bug.
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const result = sweep({ plane: "web", appRoot: APP_ROOT });
const failure = formatSweepFailure(result);

console.log(`Authz sweep (web): ${result.checked} route handlers checked against API_ROUTES.`);

if (failure) {
  console.error(`\n${failure}\n`);
  process.exitCode = 1;
} else {
  console.log(
    "Every handler is declared in the registry, guards the permission it declares, and takes its account boundary from the session.",
  );
}
