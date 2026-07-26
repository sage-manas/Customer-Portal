/**
 * Tenant back-office shell (docs/05-UI-UX-DESIGN.md §8: onboarding queue,
 * quotation workbench, credit release queue, ticket workbench, tenant
 * settings). Built out starting Phase 2 alongside the Onboarding module.
 */
export default function AdminHomePage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-bold text-text">Tenant Back-Office</h1>
      <p className="text-[12.5px] text-text-dim">Arrives with the Onboarding module (Phase 2).</p>
    </main>
  );
}
