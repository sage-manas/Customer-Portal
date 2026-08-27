/**
 * Wraps a service read so an *expected* upstream failure degrades the screen
 * instead of destroying it.
 *
 * A reachability failure is not a bug — docs/05 P7 requires the screen to
 * stay browsable and say so. Only that class is swallowed: a programming
 * error still throws, and still reaches the boundary in the route-group
 * error.tsx, because silently rendering "SAP is down" over a genuine defect
 * is how a defect survives to production.
 *
 * Matched structurally on `code`/`status` rather than with `instanceof`.
 * Every service defines its own error class over one shared
 * `DemoServiceError` base, and there is no cross-service type guard to
 * import — but the `upstream_unavailable` / 502 contract is common to all of
 * them, and is what the real @cc/service-* packages restore too. That makes
 * this the one check that survives the backend swap unchanged.
 */
interface UpstreamFailure {
  code?: string;
  status?: number;
}

export async function safeRead<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    const failure = error as UpstreamFailure;
    const unreachable =
      failure?.code === "upstream_unavailable" || failure?.status === 502 || failure?.status === 503;

    if (unreachable) {
      return { ok: false, reason: "We couldn't reach SAP just now." };
    }
    throw error;
  }
}
