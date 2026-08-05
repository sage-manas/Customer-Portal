import { z } from "zod";

import type { SapDriverKind } from "./tenant";

/**
 * The per-tenant SAP connection registry (doc 09 §3.3, doc 10 Phase 4).
 *
 * The ops console's SAP configuration screen has to render one form per
 * driver, the platform service has to validate what comes back, the
 * credential vault has to store it, and `@cc/service-sap`'s resolver has to
 * read the same keys out again. That is four places that would otherwise
 * each carry their own copy of "an ECC connection needs an endpoint, a
 * client and a service user" — precisely the hand-duplication CLAUDE.md
 * rule 3 exists to prevent, and the failure mode is silent: a form that
 * writes `sapUser` against a resolver reading `user` produces a tenant
 * whose credentials are stored, encrypted, and never used.
 *
 * So the fields are data. The form is generated from `sapConnectionFields`,
 * the validation from `sapConnectionSchema`, and the resolver reads
 * `field.key`. Adding a connection parameter is a row here.
 */

export interface SapConnectionField {
  /** Key inside the tenant's stored credential bag. */
  key: string;
  label: string;
  /**
   * Whether the value is a secret.
   *
   * This is the field that makes the screen safe rather than merely
   * encrypted: `getTenantSapConfig` returns non-secret values so an
   * operator can see what a tenant is pointed at, and returns only
   * *whether* a secret is set. A password read back into an input is a
   * password in a page cache, a browser autofill store and a screenshot,
   * and none of those are the vault.
   */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/**
 * Connection parameters per driver.
 *
 * `mock` has none, deliberately and not as an oversight: the mock driver has
 * no external system to reach (ADR-006's mock-first), so its screen shows
 * the empty state rather than an inert form. `ecc`/`s4` are Track C
 * skeletons that still throw `not_implemented` on a real call — the fields
 * below are what those drivers will read, and storing them now is what
 * makes "switch a tenant to ECC" a configuration change rather than a
 * deploy (docs/02 §4.4).
 */
export const SAP_CONNECTION_FIELDS: Record<SapDriverKind, readonly SapConnectionField[]> = {
  mock: [],
  ecc: [
    {
      key: "endpoint",
      label: "RFC endpoint",
      secret: false,
      required: true,
      placeholder: "sapecc.internal:3300",
      help: "Host:port of the application server the RFC connection targets.",
    },
    {
      key: "client",
      label: "SAP client",
      secret: false,
      required: true,
      placeholder: "100",
      help: "Three-digit mandant (MANDT).",
    },
    {
      key: "systemNumber",
      label: "System number",
      secret: false,
      required: false,
      placeholder: "00",
    },
    {
      key: "user",
      label: "Service user",
      secret: false,
      required: true,
      placeholder: "PORTAL_RFC",
      help: "A dedicated RFC user, not a named person's account.",
    },
    { key: "password", label: "Password", secret: true, required: true },
  ],
  s4: [
    {
      key: "baseUrl",
      label: "OData base URL",
      secret: false,
      required: true,
      placeholder: "https://s4.example.com/sap/opu/odata",
    },
    {
      key: "client",
      label: "SAP client",
      secret: false,
      required: false,
      placeholder: "100",
    },
    {
      key: "user",
      label: "Service user",
      secret: false,
      required: true,
      placeholder: "PORTAL_ODATA",
    },
    { key: "password", label: "Password", secret: true, required: true },
  ],
};

export function sapConnectionFields(driver: SapDriverKind): readonly SapConnectionField[] {
  return SAP_CONNECTION_FIELDS[driver];
}

export function sapConnectionField(
  driver: SapDriverKind,
  key: string,
): SapConnectionField | undefined {
  return SAP_CONNECTION_FIELDS[driver].find((field) => field.key === key);
}

/**
 * Validation derived from the registry, in the shape the *screen* submits:
 * every field optional, because a secret that is already stored is not
 * re-sent on every save (see `SapConnectionField.secret`). "Required" is
 * therefore not a property of one request — it is a property of the
 * resulting stored bag, which is what `missingSapConnectionFields` answers.
 *
 * Splitting the two is what lets an operator change an endpoint without
 * retyping a password, while still being told the configuration is
 * incomplete.
 */
export function sapConnectionSchema(driver: SapDriverKind) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of SAP_CONNECTION_FIELDS[driver]) {
    shape[field.key] = z.string().max(500).optional();
  }
  return z.object(shape).strict();
}

/** Required fields that would still be unset after `params` is stored. */
export function missingSapConnectionFields(
  driver: SapDriverKind,
  params: Readonly<Record<string, unknown>>,
): SapConnectionField[] {
  return SAP_CONNECTION_FIELDS[driver].filter((field) => {
    if (!field.required) return false;
    const value = params[field.key];
    return typeof value !== "string" || value.trim() === "";
  });
}

/**
 * What an operator changed, as a list of field *names*.
 *
 * Never values, and not only for the secrets: an audit trail is read by
 * more people than the vault is, is not encrypted at rest the way the
 * credential bag is, and "who repointed this tenant at which host" is
 * answerable from the current configuration plus who touched it. A trail
 * that recorded values would be a second, plaintext copy of the credential
 * store wearing a different name (ADR-053).
 *
 * `before`/`after` are the *stored* bags, so a secret left untouched by the
 * form does not appear here — the caller merges before diffing.
 */
export function sapConnectionDiff(
  driver: SapDriverKind,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const changed: string[] = [];
  for (const field of SAP_CONNECTION_FIELDS[driver]) {
    if ((before[field.key] ?? null) !== (after[field.key] ?? null)) changed.push(field.key);
  }
  return changed;
}

/**
 * The actions the append-only SAP configuration trail records (doc 09 §3.3).
 * A closed set rather than a free string so the trail can be filtered and
 * rendered without every writer inventing its own spelling.
 */
export const SAP_CONFIG_ACTIONS = [
  "driver.changed",
  "connection.updated",
  "connection.cleared",
  "connection.tested",
] as const;

export type SapConfigAction = (typeof SAP_CONFIG_ACTIONS)[number];

export function isSapConfigAction(value: string): value is SapConfigAction {
  return (SAP_CONFIG_ACTIONS as readonly string[]).includes(value);
}

const ACTION_LABELS: Record<SapConfigAction, string> = {
  "driver.changed": "Driver changed",
  "connection.updated": "Connection updated",
  "connection.cleared": "Connection cleared",
  "connection.tested": "Connection tested",
};

export function sapConfigActionLabel(action: SapConfigAction): string {
  return ACTION_LABELS[action];
}
