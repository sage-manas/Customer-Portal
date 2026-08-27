import Link from "next/link";

import { RegisterWizard } from "./RegisterWizard";

import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Customer onboarding (docs/03-FUNCTIONAL-SPEC.md Module 1,
 * docs/05-UI-UX-DESIGN.md §7.1) — a public, pre-auth 4-step wizard.
 * Tenant-branded, because the applicant is registering with a specific
 * supplier, not with "the portal".
 */

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const tenant = await resolveRequestTenant();

  if (!tenant) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-bold text-text">We couldn&apos;t find a portal here</h1>
        <p className="mt-2 text-[12.5px] text-text-dim">
          Check the address your supplier gave you, or contact them for the right link.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-5 bg-background p-6 lg:p-10">
      <header className="flex flex-col gap-1">
        <span className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
          {tenant.name}
        </span>
        <h1 className="text-xl font-bold text-text">Register your company</h1>
        <p className="text-[12.5px] text-text-dim">
          It takes about ten minutes. Your progress is saved as you go, so you can come back to it
          on this device.
        </p>
      </header>

      <RegisterWizard tenantSlug={tenant.slug} />

      <p className="border-t border-border pt-4 text-[12px] text-text-dim">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
        {" · "}
        <Link href="/register/status" className="font-medium text-primary hover:underline">
          Check an application&apos;s status
        </Link>
      </p>
    </main>
  );
}
