import { isPlatformError, requireOperatorSession, type OperatorClaims } from "@cc/service-platform";
import { NextResponse } from "next/server";

import { getOperatorSession } from "./session";

/** Guard + error mapping for `apps/ops` route handlers — the operator-plane mirror of apps/web's `admin-route.ts`. */
export async function requireOperator(): Promise<OperatorClaims> {
  return requireOperatorSession(await getOperatorSession());
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
