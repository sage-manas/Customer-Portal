import type { Permission } from "@cc/domain";
import {
  isPlatformError,
  requireOperatorPermission,
  type OperatorClaims,
} from "@cc/service-platform";
import { NextResponse } from "next/server";

import { getOperatorSession } from "./session";

/**
 * Guard for `apps/ops` route handlers — the operator-plane mirror of
 * apps/web's `requireBackOffice`, and named after the same idea: the
 * permission is what the handler asks for, never the role.
 *
 * It takes a permission rather than defaulting to "any operator" for the
 * reason doc 09 §3.3 exists at all: `sap_manager` now holds a console
 * session, and a session is no longer evidence of anything in particular.
 * Every handler names what it needs; `packages/domain/src/api-routes.ts`
 * declares the same thing, and the sweep fails CI when the two disagree.
 */
export async function requireOperator(permission: Permission): Promise<OperatorClaims> {
  return requireOperatorPermission(await getOperatorSession(), permission);
}

export function toOpsErrorResponse(error: unknown): NextResponse {
  if (isPlatformError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

export async function handleOps(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return toOpsErrorResponse(error);
  }
}
