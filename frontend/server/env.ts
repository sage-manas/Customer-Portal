import "server-only";

import { z } from "zod";

/**
 * Server environment, parsed once at module load.
 *
 * Parsing rather than reading `process.env` at each call site so a missing or
 * malformed variable fails at startup with the variable's name, instead of at
 * 3am inside a request as `undefined` reaching a driver.
 *
 * Nothing here may ever be re-exported through a `NEXT_PUBLIC_*` name: this
 * module is `server-only`, which makes an accidental client import a build
 * error rather than a secret in the browser bundle.
 */

/** Secrets that sign or unwrap something must be long enough to be worth signing with. */
const secret = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url("DATABASE_URL must be a Postgres connection string"),
  /** Unpooled endpoint; migrations only (see prisma.config.ts). */
  DIRECT_URL: z.string().url().optional(),

  /** Signs the customer/tenant plane's session tokens. */
  AUTH_SECRET: secret("AUTH_SECRET"),
  /**
   * Signs the platform console's tokens. A separate key so a leak of either
   * realm's secret cannot forge a token in the other (ADR-045).
   */
  OPS_AUTH_SECRET: secret("OPS_AUTH_SECRET"),
  /**
   * Wraps each tenant's data key, which in turn encrypts their SAP and
   * gateway secrets (ADR-042). 32 bytes, base64.
   */
  CREDENTIAL_MASTER_KEY: z.string().refine((value) => Buffer.from(value, "base64").length === 32, {
    message: "CREDENTIAL_MASTER_KEY must be 32 bytes, base64-encoded",
  }),

  /**
   * Which SapAdapter implementation the process resolves.
   *
   * `mock` runs the seeded in-memory landscape and is the default, so the
   * portal is demoable without a SAP system. `ecc`/`s4` select the real HTTP
   * driver, whose operations are not implemented yet — see
   * server/integrations/sap.
   */
  SAP_DRIVER: z.enum(["mock", "ecc", "s4"]).default("mock"),
  SAP_BASE_URL: z.string().url().optional(),
  SAP_CLIENT_ID: z.string().optional(),
  SAP_CLIENT_SECRET: z.string().optional(),
  SAP_USERNAME: z.string().optional(),
  SAP_PASSWORD: z.string().optional(),
  SAP_COMPANY_ID: z.string().optional(),

  /** Absolute origin, for links in mail and gateway callbacks. */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** `<slug>.<ROOT_DOMAIN>` is how a request resolves its tenant. */
  ROOT_DOMAIN: z.string().default("localhost"),
  /**
   * The tenant to assume when the host names none — a bare `localhost:3000`,
   * or a single-tenant deployment on its own domain.
   *
   * Without it a multi-tenant database refuses to guess, which is correct:
   * picking one would be a cross-tenant data leak dressed up as a
   * convenience. This makes the choice explicit and auditable instead.
   */
  DEFAULT_TENANT_SLUG: z.string().optional(),
});

function parseEnv() {
  const parsed = schema.safeParse({
    ...process.env,
    // The Phase 1 .env named this JWT_SECRET; the rest of the codebase calls
    // it AUTH_SECRET. Accept either so an existing local file keeps working.
    AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.JWT_SECRET,
    // Falls back in development only. In production a separate key is the
    // point (ADR-045), so a missing one must fail rather than share.
    OPS_AUTH_SECRET:
      process.env.OPS_AUTH_SECRET ??
      (process.env.NODE_ENV === "production"
        ? undefined
        : (process.env.AUTH_SECRET ?? process.env.JWT_SECRET)),
  });
  if (parsed.success) return parsed.data;

  const detail = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid server environment:\n${detail}\n\nSee .env.example.`);
}

export const serverEnv = parseEnv();

export type ServerEnv = typeof serverEnv;

/**
 * A real SAP driver needs a base URL before any of its operations could work.
 * Checked here rather than at the first request so the misconfiguration is
 * visible at boot.
 */
export function assertSapDriverConfigured(): void {
  if (serverEnv.SAP_DRIVER !== "mock" && !serverEnv.SAP_BASE_URL) {
    throw new Error(`SAP_DRIVER=${serverEnv.SAP_DRIVER} requires SAP_BASE_URL to be set.`);
  }
}
