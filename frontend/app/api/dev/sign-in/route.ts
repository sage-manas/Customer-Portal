import { isPlatformRole, sessionPlane } from "@cc/domain";
import { z } from "zod";

import { AuthError } from "@/server/auth/errors";
import { establishSession } from "@/server/auth/session";
import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";
import {
  operatorSignInWithoutPassword,
  signInWithoutPassword,
} from "@/server/services/identity-service";
import { resolveTenantByHost } from "@/server/services/tenant-service";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email() });

/**
 * The development role picker's sign-in.
 *
 * Signs in as a seeded account with no password, so all six roles can be
 * exercised without six sign-ins. It bypasses nothing else: a real session is
 * issued, so every guard, nav filter and 403 applies exactly as after a normal
 * login — which is what makes it useful for checking access rules rather than a
 * way around them.
 *
 * Outside development it does not exist. `notFound()` rather than a 403,
 * because a 403 would confirm the endpoint is there and merely disabled, and
 * an endpoint that hands out sessions should not advertise itself at all. The
 * service it calls refuses in production independently.
 */
export const POST = route(
  {
    guard: {
      kind: "public",
      reason: "Issues a development session; disabled entirely outside development.",
    },
  },
  async ({ request }) => {
    // A plain 404, not a 403: a 403 confirms the endpoint exists and is merely
    // switched off, and an endpoint that hands out sessions should not
    // advertise itself at all.
    if (process.env.NODE_ENV !== "development") {
      return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
    }

    const { email } = await parseBody(request, schema);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const tenant = await resolveTenantByHost(host);

    if (tenant) {
      try {
        const session = await signInWithoutPassword(tenant.id, email);
        await establishSession(session, "web");
        return {
          user: { email: session.email, roles: session.roles },
          kunnr: session.kunnr ?? null,
          availableKunnrs: session.availableKunnrs,
          plane: sessionPlane(session),
        };
      } catch (error) {
        if (!(error instanceof AuthError) || error.code !== "bad_credentials") throw error;
      }
    }

    let operator;
    try {
      operator = await operatorSignInWithoutPassword(email);
    } catch (error) {
      // Same reasoning as the real login: name the actual problem.
      if (!tenant && error instanceof AuthError && error.code === "bad_credentials") {
        throw new AuthError("tenant_unresolved");
      }
      throw error;
    }

    await establishSession(operator, "ops");
    return {
      user: { email: operator.email, roles: operator.roles.filter(isPlatformRole) },
      kunnr: null,
      availableKunnrs: [],
      plane: sessionPlane(operator),
    };
  },
);
