import { clearSession } from "@/server/auth/session";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * Public on purpose: signing out has to work with an expired or malformed
 * token, or a stale cookie can never be cleared. It deletes cookies and
 * touches nothing else, so there is no capability to guard.
 *
 * Both realms are cleared. One browser may hold a tenant session and an
 * operator session at once, and "sign out" from either shell means the person
 * has left the machine.
 */
export const POST = route(
  {
    guard: {
      kind: "public",
      reason:
        "Signing out must work with an expired token, or a stale cookie can never be cleared. Deletes cookies only.",
    },
  },
  async () => {
    await clearSession("web");
    await clearSession("ops");
    return { ok: true };
  },
);
