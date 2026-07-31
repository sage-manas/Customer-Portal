import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Authz route sweep for the operator console (docs/07 B6, mirroring
 * apps/web's scripts/authz-sweep.ts). Much smaller surface: one realm, one
 * role, so there is no permission registry to cross-check against — the
 * only question is "does every non-public route call `requireOperator()`?"
 *
 * Written independently rather than sharing code with apps/web's version:
 * these are per-app dev scripts, not application code, and the two realms'
 * shapes (permission registry vs single role) are different enough that a
 * shared abstraction would be more indirection than the ~40 lines it saves
 * (docs/DECISIONS.md ADR-045's reasoning about the operator realm applied
 * to tooling, not just runtime code).
 */

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = path.join(APP_ROOT, "app", "api");
const MIDDLEWARE_FILE = path.join(APP_ROOT, "middleware.ts");

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

export function sweep(): { route: string; file: string; guarded: boolean }[] {
  const publicPaths = readPublicPaths();
  const files = findRouteFiles(API_DIR);

  return files.map((file) => {
    const route = toRoutePath(file);
    if (isPublic(route, publicPaths)) return { route, file, guarded: true };

    const source = readFileSync(file, "utf8");
    return { route, file, guarded: /\brequireOperator\s*\(/.test(source) };
  });
}

function main() {
  const findings = sweep();
  const unguarded = findings.filter((f) => !f.guarded);

  console.log(`Authz sweep: ${findings.length} API routes checked.`);

  if (unguarded.length > 0) {
    console.error("\nRoutes with no requireOperator() call and not listed as public:");
    for (const f of unguarded) console.error(`  ${f.route}  (${path.relative(APP_ROOT, f.file)})`);
    process.exitCode = 1;
    return;
  }

  console.log("Every route is public-by-registry or calls requireOperator().");
}

main();
