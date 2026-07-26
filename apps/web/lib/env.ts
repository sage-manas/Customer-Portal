import { z } from "zod";

/**
 * Zod-validated environment (docs/06 engineering standards). Fail with a
 * readable message rather than at 2am with `undefined is not a string` —
 * and never fall back to a default secret.
 *
 * Validation is lazy (first property access) rather than at import time:
 * `next build` imports every route module to collect page data, and a build
 * machine legitimately has no runtime secrets. Anything that actually reads
 * a value does so while serving a request, where the variables must exist —
 * so a missing one still fails loudly, just not during the build.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  /** HS256 signing key for session tokens. */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters (generate: openssl rand -base64 32)"),
  /** Apex domain; tenants are <slug>.<ROOT_DOMAIN> (docs/02 §2). */
  ROOT_DOMAIN: z.string().default("localhost"),
  /**
   * Tenant used when the host carries no subdomain (local dev on
   * `localhost:3000`). Unset in production, where the host must resolve.
   */
  DEFAULT_TENANT_SLUG: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function parseEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    ROOT_DOMAIN: process.env.ROOT_DOMAIN,
    DEFAULT_TENANT_SLUG: process.env.DEFAULT_TENANT_SLUG,
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
