"use client";

import { Button, Input } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

interface ProvisionResult {
  tenantId: string;
  slug: string;
  adminEmail: string;
  temporaryPassword: string;
}

export function ProvisionForm() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<ProvisionResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: String(form.get("slug") ?? ""),
        name: String(form.get("name") ?? ""),
        customDomain: String(form.get("customDomain") ?? "") || undefined,
        adminEmail: String(form.get("adminEmail") ?? ""),
      }),
    });

    const body = (await response.json().catch(() => null)) as
      ProvisionResult | { error?: string } | null;

    if (!response.ok) {
      setError((body as { error?: string } | null)?.error ?? "That didn't go through.");
      setPending(false);
      return;
    }

    setResult(body as ProvisionResult);
    setPending(false);
  }

  if (result) {
    return (
      <div className="rounded-md border border-border bg-surface p-5">
        <p className="text-[13px] font-medium text-text">
          {result.slug} provisioned — one-time credentials for {result.adminEmail}:
        </p>
        <p className="mt-2 rounded bg-background p-2 font-mono text-[12.5px]">
          {result.temporaryPassword}
        </p>
        <p className="mt-2 text-[11.5px] text-text-dim">
          Shown once. The admin will be asked to change it at first sign-in.
        </p>
        <Button className="mt-4" onClick={() => router.push(`/tenants/${result.tenantId}`)}>
          View tenant
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-[12.5px] font-medium text-text-mid">
          Tenant name
        </label>
        <Input id="name" name="name" required placeholder="Acme Distribution Ltd" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="slug" className="text-[12.5px] font-medium text-text-mid">
          Slug
        </label>
        <Input id="slug" name="slug" required placeholder="acme" pattern="[a-z0-9-]+" />
        <p className="text-[11px] text-text-dim">
          Resolves the tenant at &lt;slug&gt;.&lt;root-domain&gt;.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="customDomain" className="text-[12.5px] font-medium text-text-mid">
          Custom domain (optional)
        </label>
        <Input id="customDomain" name="customDomain" placeholder="portal.acme.example" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="adminEmail" className="text-[12.5px] font-medium text-text-mid">
          First admin email
        </label>
        <Input
          id="adminEmail"
          name="adminEmail"
          type="email"
          required
          placeholder="admin@acme.example"
        />
        <p className="text-[11px] text-text-dim">
          Issued a client_admin login with a one-time password (mock/ecc/s4 driver defaults to
          mock).
        </p>
      </div>

      <p role="alert" aria-live="polite" className="min-h-[18px] text-[12px] text-danger">
        {error}
      </p>

      <Button type="submit" loading={pending} className="w-fit">
        {pending ? "Provisioning…" : "Provision tenant"}
      </Button>
    </form>
  );
}
