import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PERMISSIONS } from "@cc/domain";

/**
 * Authz route sweep (docs/07 B6: "authz test sweep (every route x role)").
 *
 * A live-server, log-in-as-every-role click-through would need a database,
 * a browser and O(routes x roles) requests, and would only catch what the
 * chosen fixture data happens to exercise. This is a static sweep instead:
 * every `/api/**` route handler is source, and CLAUDE.md rule 5 already says
 * where enforcement must live — "hiding a nav item is presentation;
 * `requirePermission` in the route handler is the control" — so the
 * question this script answers is exactly that one, mechanically, for every
 * route at once: does this file call a guard, and if so, is the permission
 * it names a real one?
 *
 * Deliberately scoped to `/api/**` and not `/app/**` pages: a page redirect
 * on a missing permission is UX, and CLAUDE.md is explicit that the API is
 * what enforces. A page with no guard but a properly-guarded API behind it
 * is a UX bug, not an authz bug.
 *
 * What this catches:
 *   - a new route with no guard call at all (the most common way an authz
 *     bug ships: someone copies a handler and forgets the first line).
 *   - a guard called with a permission string that doesn't exist in the
 *     `@cc/domain` registry (a typo that would silently always throw, or
 *     — if `requirePermission`'s signature ever loosens — silently never
 *     enforce anything).
 *
 * What this does NOT catch (needs the live-server matrix docs/07 B6 also
 * lists as a follow-up, not something a static sweep can replace): whether
 * the *right* permission was chosen for a route, or whether a service-layer
 * check beneath the route is itself correct. This sweep proves every route
 * is wired to *some* real permission — not that the wiring is the right one.
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = path.join(APP_ROOT, "app", "api");
const MIDDLEWARE_FILE = path.join(APP_ROOT, "middleware.ts");

const GUARD_PATTERN =
  /\b(requirePortal|requireBackOffice|requireSession|requirePermission)\s*\(([^)]*)\)/g;
const PERMISSION_LITERAL_PATTERN = /["']([a-z][a-z0-9:-]*)["']/g;

function readPublicPaths(): string[] {
  const source = readFileSync(MIDDLEWARE_FILE, "utf8");
  const match = /const PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!match) {
    throw new Error("Could not find PUBLIC_PATHS in middleware.ts — has it been renamed?");
  }
  const captured = match[1] ?? "";
  return [...captured.matchAll(/["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((value): value is string => value !== undefined);
}

function isPublic(routePath: string, publicPaths: string[]): boolean {
  return publicPaths.some((p) => routePath === p || routePath.startsWith(`${p}/`));
}

function findRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      findRouteFiles(full, out);
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function toRoutePath(file: string): string {
  const rel = path
    .relative(API_DIR, file)
    .replace(/\\/g, "/")
    .replace(/\/route\.ts$/, "");
  return `/api/${rel}`;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const EXPORT_HANDLER_PATTERN = new RegExp(
  `export\\s+async\\s+function\\s+(${HTTP_METHODS.join("|")})\\s*\\(`,
  "g",
);

interface RouteFinding {
  route: string;
  method: string;
  file: string;
  guarded: boolean;
  unknownPermissions: string[];
}

/**
 * Splits a route file into one segment per exported HTTP-method handler.
 * File-level checking would pass a file where only the GET handler is
 * guarded and POST is not — proven by hand while building this script: a
 * sed that stripped only the GET handler's guard call left the file-level
 * check green, because the POST handler's own guard call was still
 * somewhere in the file. Segmenting first is what makes "every route" mean
 * every method, not every file.
 */
function splitHandlers(source: string): { method: string; body: string }[] {
  const matches = [...source.matchAll(EXPORT_HANDLER_PATTERN)];
  if (matches.length === 0) return [{ method: "*", body: source }];

  return matches.map((match, i) => {
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? source.length;
    return { method: match[1] ?? "unknown", body: source.slice(start, end) };
  });
}

export function sweep(): RouteFinding[] {
  const publicPaths = readPublicPaths();
  const knownPermissions = new Set<string>(PERMISSIONS);
  const files = findRouteFiles(API_DIR);
  const findings: RouteFinding[] = [];

  for (const file of files) {
    const route = toRoutePath(file);
    if (isPublic(route, publicPaths)) {
      findings.push({ route, method: "*", file, guarded: true, unknownPermissions: [] });
      continue;
    }

    const source = readFileSync(file, "utf8");
    for (const { method, body } of splitHandlers(source)) {
      const guardCalls = [...body.matchAll(GUARD_PATTERN)];
      const guarded = guardCalls.length > 0;

      const unknownPermissions: string[] = [];
      for (const call of guardCalls) {
        const args = call[2] ?? "";
        for (const literal of args.matchAll(PERMISSION_LITERAL_PATTERN)) {
          const value = literal[1];
          // requireSession() takes no permission argument, and a session
          // built inline (`await getSession()`) is not a permission literal —
          // only check strings that look like `resource:verb`, the registry's
          // own naming shape, so we don't flag an unrelated string argument.
          if (value !== undefined && value.includes(":") && !knownPermissions.has(value)) {
            unknownPermissions.push(value);
          }
        }
      }

      findings.push({ route, method, file, guarded, unknownPermissions });
    }
  }

  return findings;
}

function main() {
  const findings = sweep();
  const unguarded = findings.filter((f) => !f.guarded);
  const badPermissions = findings.filter((f) => f.unknownPermissions.length > 0);

  console.log(`Authz sweep: ${findings.length} route handlers checked.`);

  if (unguarded.length > 0) {
    console.error("\nHandlers with no session/permission guard and not listed as public:");
    for (const f of unguarded) {
      console.error(`  ${f.method} ${f.route}  (${path.relative(APP_ROOT, f.file)})`);
    }
  }

  if (badPermissions.length > 0) {
    console.error("\nHandlers citing a permission that isn't in the @cc/domain registry:");
    for (const f of badPermissions) {
      console.error(`  ${f.method} ${f.route}: ${f.unknownPermissions.join(", ")}`);
    }
  }

  if (unguarded.length > 0 || badPermissions.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("Every handler is public-by-registry or calls a guard naming a real permission.");
}

main();
