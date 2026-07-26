import { CANONICAL_STATUSES } from "@cc/domain/status";
import { DocumentNumber, Money, StatusBadge } from "@cc/ui";

/**
 * Phase 0 scaffold page — proves the monorepo wiring (Next.js -> @cc/ui ->
 * @cc/domain, Tailwind tokens, fonts) works end to end. The real Customer
 * Dashboard (docs/05-UI-UX-DESIGN.md §7.0 — hero band, KPI row, recent
 * orders/invoices tables) arrives in Phase 1/2 once auth and the mock SAP
 * adapter exist.
 */
export default function PortalHomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-xl font-bold text-text">CustomerConnect Portal</h1>
        <p className="text-[12.5px] text-text-dim">
          Phase 0 scaffold — monorepo foundation is wired up. The real dashboard lands in a later
          phase.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-[15px] font-bold text-text">Canonical statuses (@cc/domain)</h2>
        <div className="flex flex-wrap gap-2">
          {CANONICAL_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-[15px] font-bold text-text">Sample order (@cc/ui)</h2>
        <div className="flex items-center justify-between text-[12.5px]">
          <DocumentNumber value="SO-2025-1841" />
          <Money value={480000} />
        </div>
      </section>
    </main>
  );
}
