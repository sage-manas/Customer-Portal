import { z } from "zod";

/**
 * Zod-validated environment for the operator console — its own copy of
 * apps/web's `lib/env.ts` pattern, deliberately reading a *different* secret
 * (`OPS_AUTH_SECRET`, not `AUTH_SECRET`): a leaked or misconfigured web
 * secret must never also grant operator access (docs/DECISIONS.md ADR-045).
 *
 * Validation is lazy (first property access), not at import time — `next
 * build` imports every route module to collect page data, and a build
 * machine legitimately has no runtime secrets.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  OPS_AUTH_SECRET: z
    .string()
    .min(32, "OPS_AUTH_SECRET must be at least 32 characters (generate: openssl rand -base64 32)"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function parseEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    OPS_AUTH_SECRET: process.env.OPS_AUTH_SECRET,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }

  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get: (_target, property: string) => parseEnv()[property as keyof Env],
});
