import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  API_ROUTES,
  apiRouteKey,
  apiRoutesForPlane,
  type ApiPlane,
  type ApiRoute,
  type HttpMethod,
} from "./api-routes";

/**
 * The registry-to-filesystem sweep (doc 10 Phase 3: "adding a route without
 * declaring its permission must fail CI").
 *
 * The matrix tests prove the registry and the guards agree about *roles*.
 * This proves the registry and the `app/api/**` tree agree about *routes* —
 * the half no amount of unit testing can reach, because a handler nobody
 * declared is a handler nobody wrote a test for either. It checks both
 * directions:
 *
 *   - a handler on disk with no row here fails, which is the common way an
 *     authz bug ships (someone copies a route and forgets the first line);
 *   - a row here with no handler fails, so the registry can't quietly
 *     accumulate rows describing routes that were deleted, which would make
 *     the matrix tests pass by asserting things about nothing;
 *   - a handler whose guard names a *different* permission than its row
 *     fails. This is the check the previous version of the sweep could not
 *     make: it only knew the shape of a guard call, so `requirePortal
 *     ("catalogue:view")` on the order-cancel route was invisible to it.
 *
 * It lives in `@cc/domain`, beside the registry it reads, because both apps
 * need exactly the same checks and the alternative was a second copy that
 * drifts — the failure mode this whole phase exists to remove. It is
 * build-time tooling, deliberately *not* exported from the package index:
 * nothing in a request path may import `node:fs`.
 *
 * What it still cannot answer: whether the declared permission is the
 * *right* one. That is a judgement, made in review against doc 09 §2, and
 * the registry is now where a reviewer can see all of them at once.
 */

const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const EXPORT_HANDLER_PATTERN = new RegExp(
  `export\\s+async\\s+function\\s+(${HTTP_METHODS.join("|")})\\s*\\(`,
  "g",
);

/** Any of the four guard entry points, portal or console, with its arguments. */
const GUARD_PATTERN =
  /\b(requirePortal|requireBackOffice|requireOperator|requireSession|requirePermission|requireOperatorPermission|requireOperatorSession)\s*\(([^)]*)\)/g;

const PERMISSION_LITERAL_PATTERN = /["']([a-z][a-z0-9:-]*)["']/g;

/** How a handler proves the account boundary came from the session and not
 * the request — the `scope: "kunnr"` obligation (ADR-025's reasoning). */
const SESSION_KUNNR_PATTERN = /session\.kunnr|resolveActiveKunnr|requireCustomerAccount/;

export interface SweepOptions {
  plane: ApiPlane;
  /** The app directory: the one containing `app/api` and `middleware.ts`. */
  appRoot: string;
}

export interface SweepProblem {
  kind:
    | "undeclared"
    | "stale"
    | "unguarded"
    | "wrong-permission"
    | "public-mismatch"
    | "unscoped-account";
  route: string;
  detail: string;
}

export interface SweepResult {
  checked: number;
  problems: SweepProblem[];
}

function findRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) findRouteFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function toRoutePath(apiDir: string, file: string): string {
  const rel = path
    .relative(apiDir, file)
    .replace(/\\/g, "/")
    .replace(/\/route\.ts$/, "");
  return `/api/${rel}`;
}

/**
 * Splits a route file into one segment per exported handler.
 *
 * File-level checking would pass a file whose GET is guarded and whose POST
 * is not — proven by hand while building the first version of this sweep:
 * removing the GET's guard left the file-level check green because the
 * POST's guard was still somewhere in the file. Segmenting is what makes
 * "every route" mean every method rather than every file.
 */
function splitHandlers(source: string): { method: HttpMethod; body: string }[] {
  const matches = [...source.matchAll(EXPORT_HANDLER_PATTERN)];
  return matches.map((match, i) => ({
    method: match[1] as HttpMethod,
    body: source.slice(match.index ?? 0, matches[i + 1]?.index ?? source.length),
  }));
}

function readPublicPaths(middlewareFile: string): string[] {
  const source = readFileSync(middlewareFile, "utf8");
  const match = /const PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!match) {
    throw new Error(`Could not find PUBLIC_PATHS in ${middlewareFile} — has it been renamed?`);
  }
  return [...(match[1] ?? "").matchAll(/["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((value): value is string => value !== undefined);
}

function isPublicInMiddleware(routePath: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((p) => routePath === p || routePath.startsWith(`${p}/`));
}

/** The permission literals a handler's guard calls actually name. */
function guardedPermissions(body: string): { calls: number; permissions: string[] } {
  const calls = [...body.matchAll(GUARD_PATTERN)];
  const permissions: string[] = [];
  for (const call of calls) {
    for (const literal of (call[2] ?? "").matchAll(PERMISSION_LITERAL_PATTERN)) {
      // Only `resource:verb`-shaped strings: `requireSession()` takes no
      // permission, and an unrelated string argument is not one either.
      if (literal[1]?.includes(":")) permissions.push(literal[1]);
    }
  }
  return { calls: calls.length, permissions };
}

export function sweep({ plane, appRoot }: SweepOptions): SweepResult {
  const apiDir = path.join(appRoot, "app", "api");
  const publicPaths = readPublicPaths(path.join(appRoot, "middleware.ts"));
  const declared = new Map(apiRoutesForPlane(plane).map((route) => [apiRouteKey(route), route]));
  const seen = new Set<string>();
  const problems: SweepProblem[] = [];
  let checked = 0;

  for (const file of findRouteFiles(apiDir)) {
    const routePath = toRoutePath(apiDir, file);
    const source = readFileSync(file, "utf8");

    for (const { method, body } of splitHandlers(source)) {
      checked += 1;
      const key = apiRouteKey({ plane, method, path: routePath });
      const route: ApiRoute | undefined = declared.get(key);

      if (!route) {
        problems.push({
          kind: "undeclared",
          route: key,
          detail: `No row in API_ROUTES (packages/domain/src/api-routes.ts). Declare the permission this handler requires.`,
        });
        continue;
      }
      seen.add(key);

      const { calls, permissions } = guardedPermissions(body);
      const publicInMiddleware = isPublicInMiddleware(routePath, publicPaths);

      if (route.guard.kind === "public") {
        if (!publicInMiddleware) {
          problems.push({
            kind: "public-mismatch",
            route: key,
            detail: "Declared public but not listed in middleware.ts PUBLIC_PATHS.",
          });
        }
        continue;
      }

      if (publicInMiddleware) {
        problems.push({
          kind: "public-mismatch",
          route: key,
          detail:
            "Guarded in the registry but matched by middleware.ts PUBLIC_PATHS — the middleware wins for page loads and the route is effectively open.",
        });
      }

      if (calls === 0) {
        problems.push({
          kind: "unguarded",
          route: key,
          detail: "Handler calls no guard at all.",
        });
      } else if (route.guard.kind === "permission") {
        const wanted = route.guard.permission;
        if (!permissions.includes(wanted)) {
          problems.push({
            kind: "wrong-permission",
            route: key,
            detail: `Registry declares "${wanted}"; the handler guards ${
              permissions.length > 0 ? permissions.map((p) => `"${p}"`).join(", ") : "no permission"
            }.`,
          });
        }
      }

      if (route.scope === "kunnr" && !SESSION_KUNNR_PATTERN.test(body)) {
        problems.push({
          kind: "unscoped-account",
          route: key,
          detail:
            'Declared scope "kunnr" but the handler never reads the account from the session — a sold-to taken from the request is not a boundary.',
        });
      }
    }
  }

  for (const [key] of declared) {
    if (seen.has(key)) continue;
    problems.push({
      kind: "stale",
      route: key,
      detail: "Declared in API_ROUTES but no handler exports it. Delete the row or the route.",
    });
  }

  return { checked, problems };
}

/** Formats a result for a CI log. Returns null when everything agrees. */
export function formatSweepFailure(result: SweepResult): string | null {
  if (result.problems.length === 0) return null;

  const byKind = new Map<string, SweepProblem[]>();
  for (const problem of result.problems) {
    byKind.set(problem.kind, [...(byKind.get(problem.kind) ?? []), problem]);
  }

  return [...byKind.entries()]
    .map(
      ([kind, problems]) =>
        `${kind}:\n${problems.map((p) => `  ${p.route}\n    ${p.detail}`).join("\n")}`,
    )
    .join("\n\n");
}

/** Total declared handlers, both planes — used by each app's script to
 * report how much of the registry it is responsible for. */
export function declaredRouteCount(): number {
  return API_ROUTES.length;
}
