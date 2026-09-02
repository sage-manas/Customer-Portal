import { sessionPlane } from "@cc/domain";
import { z } from "zod";

import { establishSession } from "@/server/auth/session";
import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";
import { AuthError } from "@/server/auth/errors";
import { login, operatorLogin } from "@/server/services/identity-service";
import { resolveTenantByHost } from "@/server/services/tenant-service";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address."),
  // Deliberately no shape rules: this is the password a user already has, and
  // rejecting it for failing today's policy would lock out an old account.
  password: z.string().min(1, "Enter your password."),
});

/**
 * Issues the session for both planes.
 *
 * One endpoint, because the merged app has one login screen. The plane is
 * derived from the credentials rather than chosen by the caller: an operator
 * signs in against the operator table and gets an operator cookie signed with
 * the operator secret, and there is no request field that could move a tenant
 * user into the platform realm.
 *
 * The tenant is resolved from the *host*, not the body — otherwise anyone
 * could name a tenant and have their email looked up inside it.
 */
export const POST = route(
  { guard: { kind: "public", reason: "Issues the session; there is nothing to authorize yet." } },
  async ({ request }) => {
    const input = await parseBody(request, loginSchema);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const tenant = await resolveTenantByHost(host);

    if (tenant) {
      try {
        const { session, mustChangePassword } = await login(tenant.id, input);
        await establishSession(session, "web");
        return {
          user: { email: session.email, roles: session.roles },
          kunnr: session.kunnr ?? null,
          availableKunnrs: session.availableKunnrs,
          plane: sessionPlane(session),
          mustChangePassword,
        };
      } catch (error) {
        // Fall through to the operator realm only when the tenant realm did
        // not recognise the credentials. Any other failure — a deactivated
        // account, an inactive tenant — is the real answer and must surface.
        if (!(error instanceof AuthError) || error.code !== "bad_credentials") throw error;
      }
    }

    /**
     * No tenant resolved from the host, and the credentials are not an
     * operator's either. That is a configuration problem, not a wrong
     * password, so it says so — otherwise a developer on `localhost:3000`
     * with two tenants in the database is told their correct password is
     * wrong, forever.
     */
    let operator;
    try {
      operator = await operatorLogin(input);
    } catch (error) {
      if (!tenant && error instanceof AuthError && error.code === "bad_credentials") {
        throw new AuthError("tenant_unresolved");
      }
      throw error;
    }

    await establishSession(operator, "ops");
    return {
      user: { email: operator.email, roles: operator.roles },
      kunnr: null,
      availableKunnrs: [],
      plane: sessionPlane(operator),
      mustChangePassword: false,
    };
  },
);
