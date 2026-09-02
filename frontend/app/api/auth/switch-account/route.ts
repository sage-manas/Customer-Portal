import { z } from "zod";

import { establishSession } from "@/server/auth/session";
import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";
import { switchAccount } from "@/server/services/identity-service";

export const dynamic = "force-dynamic";

const switchSchema = z.object({
  kunnr: z.string().trim().min(1, "Choose an account."),
});

/**
 * Changes which sold-to account the session acts for.
 *
 * Guarded by `session` and no permission: switching between accounts the user
 * already holds is not a capability. The control that matters is inside
 * `switchAccount`, which re-reads the link from the database — the token's own
 * `availableKunnrs` is not evidence, because it was minted before whatever
 * changed since.
 */
export const POST = route({ guard: { kind: "session" } }, async ({ request, session }) => {
  const { kunnr } = await parseBody(request, switchSchema);
  const next = await switchAccount(session, kunnr);
  await establishSession(next, "web");
  return { kunnr: next.kunnr, availableKunnrs: next.availableKunnrs };
});
