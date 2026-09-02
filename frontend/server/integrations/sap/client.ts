import "server-only";

import { serverEnv } from "@/server/env";

/**
 * The transport a real SAP driver speaks over.
 *
 * Everything credential-shaped lives behind this file: the driver modules
 * compose requests and map payloads, and never see a password. That is what
 * makes "SAP credentials must not reach the client bundle" checkable by
 * looking at one import graph rather than by grepping the whole app.
 *
 * TODO: SAP INTEGRATION
 * Implement the real transport. What it needs to do:
 *   - obtain a token (OAuth client-credentials against SAP_BASE_URL for S/4
 *     Cloud, or basic auth + an x-csrf-token fetch for on-premise gateways),
 *   - cache it until shortly before it expires, and refresh once per process
 *     rather than once per request,
 *   - send SAP_COMPANY_ID / sap-client as the landscape requires,
 *   - translate a non-2xx into the error classes below so callers can tell
 *     "unreachable" from "refused", which is the distinction the whole
 *     degradation path in the UI is built on.
 */

export interface SapRequest {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** SAP function module or OData entity set, for logs and error messages. */
  operation: string;
}

export interface SapHttpClient {
  request<T>(input: SapRequest): Promise<T>;
}

export interface SapCredentials {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  companyId?: string;
}

/**
 * Reads the process-level SAP credentials.
 *
 * Per-tenant credentials live encrypted in `tenant_credentials` and are
 * resolved through the vault instead; this is the single-landscape fallback a
 * self-hosted deployment uses.
 */
export function credentialsFromEnv(): SapCredentials {
  if (!serverEnv.SAP_BASE_URL) {
    throw new Error("SAP_BASE_URL is not configured.");
  }
  return {
    baseUrl: serverEnv.SAP_BASE_URL,
    clientId: serverEnv.SAP_CLIENT_ID,
    clientSecret: serverEnv.SAP_CLIENT_SECRET,
    username: serverEnv.SAP_USERNAME,
    password: serverEnv.SAP_PASSWORD,
    companyId: serverEnv.SAP_COMPANY_ID,
  };
}

export function createSapHttpClient(_credentials: SapCredentials): SapHttpClient {
  return {
    async request<T>(input: SapRequest): Promise<T> {
      // TODO: SAP INTEGRATION
      throw new Error(
        `SAP operation "${input.operation}" is not implemented: no SAP transport is wired up yet.`,
      );
    },
  };
}
