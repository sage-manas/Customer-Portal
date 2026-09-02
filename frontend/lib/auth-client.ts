"use client";

import { sessionPlane, type Role } from "@cc/domain";

/**
 * Browser-side authentication.
 *
 * Replaces the Phase 1 `lib/demo-auth.ts`, which set a cookie from the browser
 * and called nothing. Every function here is a request to a real endpoint, and
 * the session cookies it establishes are `HttpOnly` — which means this module
 * cannot read them, by design. Anything the UI needs to know about the current
 * user comes from the server on render, not from here.
 */

export interface SignInResult {
  user: { email: string; roles: Role[] };
  kunnr: string | null;
  availableKunnrs: string[];
  plane: ReturnType<typeof sessionPlane>;
  mustChangePassword?: boolean;
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Reads the API's error shape: `{ error, code, issues }`. */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await post("/api/auth/login", { email, password });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "We couldn't sign you in. Please try again."));
  }
  return (await response.json()) as SignInResult;
}

/**
 * Signs in as a seeded account without a password. Development only — the
 * endpoint does not exist otherwise, and this surfaces that as a plain error
 * rather than pretending it worked.
 */
export async function signInAsRole(email: string): Promise<SignInResult> {
  const response = await post("/api/dev/sign-in", { email });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, "Role switching is only available in development."),
    );
  }
  return (await response.json()) as SignInResult;
}

export async function signOut(): Promise<void> {
  await post("/api/auth/logout");
}

export async function switchKunnr(kunnr: string): Promise<void> {
  const response = await post("/api/auth/switch-account", { kunnr });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "We couldn't switch account."));
  }
}

/**
 * Where a session lands after signing in, derived from its plane (ADR-062)
 * rather than from a role name.
 */
export function landingPathFor(roles: Role[]): string {
  switch (sessionPlane({ roles })) {
    case "platform":
      // The console root forwarded to the first tab the operator could open;
      // `/tenants` is that tab for `super_admin`, and `sap_manager` is
      // redirected on from there by the page guard.
      return roles.includes("super_admin") ? "/tenants" : "/sap/config";
    case "back_office":
      return "/admin";
    default:
      return "/";
  }
}
