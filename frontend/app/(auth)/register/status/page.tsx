import { StatusTimeline } from "./StatusTimeline";

import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Application status (docs/05-UI-UX-DESIGN.md §7.1): the timeline the
 * applicant sees after submitting, plus the decision and its reasons.
 */

export const dynamic = "force-dynamic";

export default async function RegisterStatusPage() {
  const tenant = await resolveRequestTenant();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 bg-background p-6 lg:p-10">
      <header className="flex flex-col gap-1">
        <span className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
          {tenant?.name ?? "CustomerConnect"}
        </span>
        <h1 className="text-xl font-bold text-text">Your application</h1>
      </header>

      <StatusTimeline tenantSlug={tenant?.slug ?? ""} />
    </main>
  );
}
