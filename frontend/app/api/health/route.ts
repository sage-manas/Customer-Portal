import { prisma } from "@/lib/prisma";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a real database round-trip.
 *
 * Public because a load balancer is not a tenant. It reports only whether
 * dependencies answer — never a version, a host or a driver name, which is
 * reconnaissance for anyone who finds the URL.
 */
export const GET = route(
  { guard: { kind: "public", reason: "Health checks run before any session exists." } },
  async () => {
    const startedAt = Date.now();
    let database: "up" | "down" = "up";

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }

    const body = {
      status: database === "up" ? ("ok" as const) : ("degraded" as const),
      database,
      latencyMs: Date.now() - startedAt,
    };

    return Response.json(body, { status: database === "up" ? 200 : 503 });
  },
);
