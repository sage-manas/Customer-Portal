/**
 * 4-step onboarding wizard entry point (docs/03-FUNCTIONAL-SPEC.md Module 1,
 * docs/05-UI-UX-DESIGN.md §7.1). Built out in Phase 2 on top of the
 * onboardingMapping registry and onboardingWriteSchema (@cc/domain).
 */
export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-bold text-text">Register your company</h1>
      <p className="text-[12.5px] text-text-dim">The onboarding wizard arrives in Phase 2.</p>
    </main>
  );
}
