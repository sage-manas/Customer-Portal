import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { API_ROUTES, apiRouteKey, rolesAllowedOn, type ApiRoute } from "@cc/domain";
import { describe, expect, it } from "vitest";

/**
 * The route registry and the handlers on disk must agree.
 *
 * `API_ROUTES` in @cc/domain declares the permission behind every handler as
 * data; `route({ guard })` enforces it in the handler. Two copies of one fact
 * drift unless something compares them, and the failure mode is the dangerous
 * direction: a handler that quietly guards a *weaker* permission than the
 * registry advertises still passes every test written against its own file.
 *
 * So this reads the guard out of each handler's source and checks it against
 * the declaration. It also fails a handler that is not declared at all, which
 * is how a new route gets forced into the registry rather than into obscurity.
 *
 * Routes that are declared but not yet built are reported, not failed — the
 * backend is being restored incrementally, and a list of what is left is more
 * useful than a red suite that says the same thing every run.
 */

const API_DIR = path.join(process.cwd(), "app", "api");

type Guard = { kind: string; permission?: string };

interface DiscoveredRoute {
  /** As Next routes it: `/api/orders/[vbeln]`. */
  urlPath: string;
  file: string;
  /** Each exported HTTP method with the guard that method enforces. */
  guards: Map<string, Guard | null>;
}

function walk(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

/** `app/api/orders/[vbeln]/route.ts` -> `/api/orders/[vbeln]`. */
function toUrlPath(file: string): string {
  const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
  return (
    `/${rel.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`
      // Route groups are organisational and contribute nothing to the URL.
      .replace(/\/\([^/]+\)/g, "")
  );
}

function guardIn(segment: string): Guard | null {
  const permission = segment.match(/guard:\s*\{\s*kind:\s*"permission",\s*permission:\s*"([^"]+)"/);
  if (permission) return { kind: "permission", permission: permission[1] };
  if (/guard:\s*\{\s*kind:\s*"session"/.test(segment)) return { kind: "session" };
  if (/guard:\s*\{\s*kind:\s*"public"/.test(segment)) return { kind: "public" };
  return null;
}

/**
 * Reads each exported method's guard from its own `route({ guard: ... })` call.
 *
 * Per method, not per file: one route.ts commonly exports a GET that reads and
 * a POST that writes, guarded by different permissions. Reading the first
 * guard in the file and attributing it to every method compares the wrong pair
 * — and does so in the direction that hides a too-weak write guard behind a
 * correct read one.
 *
 * Deliberately a source scan rather than an import: importing a handler pulls
 * in `server-only`, Prisma and the env parser, so the check would depend on a
 * database being reachable to answer a question about static text.
 */
function readMethodGuards(source: string): Map<string, Guard | null> {
  const found = new Map<string, Guard | null>();
  const starts = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)];

  starts.forEach((match, index) => {
    const from = match.index ?? 0;
    const next = starts[index + 1]?.index;
    found.set(match[1], guardIn(source.slice(from, next ?? source.length)));
  });

  return found;
}

const discovered: DiscoveredRoute[] = walk(API_DIR).map((file) => ({
  urlPath: toUrlPath(file),
  file: path.relative(process.cwd(), file).split(path.sep).join("/"),
  guards: readMethodGuards(readFileSync(file, "utf8")),
}));

/**
 * Development-only endpoints are exempt from the registry.
 *
 * The registry describes the product's API. `/api/dev/*` does not exist
 * outside development and must never be declared as though it did.
 */
const EXEMPT = new Set(["/api/dev/sign-in"]);

/** A path may be declared on either plane; the merged app serves one handler. */
function declarationsFor(urlPath: string, method: string): ApiRoute[] {
  return API_ROUTES.filter((route) => route.path === urlPath && route.method === method);
}

function describeGuard(guard: Guard | ApiRoute["guard"] | null): string {
  if (!guard) return "none";
  return guard.kind === "permission" ? `permission:${guard.permission}` : guard.kind;
}

describe("api route registry", () => {
  it("discovers the handlers on disk", () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  it("every exported method declares a guard", () => {
    const missing = discovered.flatMap((route) =>
      [...route.guards.entries()]
        .filter(([, guard]) => guard === null)
        .map(([method]) => `${method} ${route.urlPath} (${route.file})`),
    );
    expect(missing).toEqual([]);
  });

  it("every handler is declared in API_ROUTES", () => {
    const undeclared = discovered
      .filter((route) => !EXEMPT.has(route.urlPath))
      .flatMap((route) =>
        [...route.guards.keys()]
          .filter((method) => declarationsFor(route.urlPath, method).length === 0)
          .map((method) => `${method} ${route.urlPath} (${route.file})`),
      );
    expect(undeclared).toEqual([]);
  });

  it("every handler enforces the permission it declares", () => {
    const mismatches: string[] = [];

    for (const route of discovered) {
      if (EXEMPT.has(route.urlPath)) continue;

      for (const [method, guard] of route.guards) {
        const declarations = declarationsFor(route.urlPath, method);
        if (declarations.length === 0) continue;

        // A path declared on both planes is one handler serving both; it
        // agrees if it matches either declaration.
        const agrees = declarations.some((declared) => {
          if (declared.guard.kind !== guard?.kind) return false;
          if (declared.guard.kind === "permission") {
            return declared.guard.permission === guard.permission;
          }
          return true;
        });

        if (!agrees) {
          mismatches.push(
            `${method} ${route.urlPath}: declares ${declarations
              .map((d) => describeGuard(d.guard))
              .join(" | ")}, enforces ${describeGuard(guard)}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("a permission-guarded route admits at least one role", () => {
    // A permission no role holds would make the handler unreachable — which is
    // a registry mistake, not a deliberately locked door.
    const unreachable = API_ROUTES.filter((route) => rolesAllowedOn(route).length === 0).map(
      apiRouteKey,
    );
    expect(unreachable).toEqual([]);
  });

  it("reports which declared routes are not built yet", () => {
    const built = new Set(
      discovered.flatMap((route) =>
        [...route.guards.keys()].map((method) => `${method} ${route.urlPath}`),
      ),
    );
    const pending = API_ROUTES.filter((route) => !built.has(`${route.method} ${route.path}`));

    // Informational: this is the remaining work, not a defect.
    console.log(`\n  ${built.size} handlers built, ${pending.length} declared and pending.`);
    expect(pending.length + built.size).toBeGreaterThan(0);
  });
});
