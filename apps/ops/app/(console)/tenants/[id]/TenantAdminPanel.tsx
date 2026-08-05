"use client";

import { Button, Input } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Tenant edit + deactivation (doc 09 §3.3: "deactivate = soft, confirmation
 * dialog naming consequences").
 *
 * The dialog spells out what deactivation does rather than asking "are you
 * sure?", and it asks the operator to type the slug. Both are for the same
 * reason: this is the one control in the console whose blast radius is an
 * entire customer's staff being unable to sign in, and a confirmation an
 * operator can dismiss by reflex is not a confirmation. The consequences
 * listed here are the ones `setTenantActive` actually causes — if that
 * function's behaviour changes, this copy is wrong and must change with it.
 */
export function TenantAdminPanel({
  tenantId,
  slug,
  name,
  customDomain,
  isActive,
}: {
  tenantId: string;
  slug: string;
  name: string;
  customDomain: string | null;
  isActive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [typedSlug, setTypedSlug] = React.useState("");

  async function send(url: string, method: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);

    if (!response.ok) {
      const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(parsed?.error ?? "That didn't go through.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await send(`/api/tenants/${tenantId}`, "PATCH", {
      name: String(form.get("name") ?? ""),
      customDomain: String(form.get("customDomain") ?? ""),
    });
  }

  async function onToggleActive() {
    const ok = await send(`/api/tenants/${tenantId}/status`, "POST", { isActive: !isActive });
    if (ok) {
      setConfirming(false);
      setTypedSlug("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={onSave}
        className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-[12.5px] font-medium text-text-mid">
            Tenant name
          </label>
          <Input id="name" name="name" defaultValue={name} required />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="customDomain" className="text-[12.5px] font-medium text-text-mid">
            Custom domain
          </label>
          <Input id="customDomain" name="customDomain" defaultValue={customDomain ?? ""} />
          <p className="text-[11px] text-text-dim">
            Blank falls back to {slug}.&lt;root-domain&gt;.
          </p>
        </div>

        <Button type="submit" loading={pending} className="w-fit">
          Save changes
        </Button>
      </form>

      <div className="rounded-md border border-danger/40 bg-surface p-5">
        <h3 className="text-[12.5px] font-bold text-text">
          {isActive ? "Deactivate tenant" : "Reactivate tenant"}
        </h3>

        {isActive ? (
          <>
            <p className="mt-1 text-[11.5px] text-text-dim">
              Deactivation is reversible and deletes nothing.
            </p>
            {confirming ? (
              <div className="mt-3 flex flex-col gap-3">
                <ul className="list-disc space-y-1 pl-5 text-[11.5px] text-text-mid">
                  <li>
                    Every user of <span className="font-mono">{slug}</span> — buyers and back office
                    — is refused at sign-in.
                  </li>
                  <li>
                    Sessions already open keep working until their access token expires (up to 30
                    minutes); this is not a remote sign-out.
                  </li>
                  <li>
                    Orders, deliveries, invoices, payments and support history stay exactly as they
                    are. Nothing is deleted, here or later.
                  </li>
                  <li>
                    Background work keeps running: outbox events still relay, so SAP documents keep
                    their portal-side effects.
                  </li>
                </ul>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="confirmSlug" className="text-[12px] font-medium text-text-mid">
                    Type <span className="font-mono">{slug}</span> to confirm
                  </label>
                  <Input
                    id="confirmSlug"
                    value={typedSlug}
                    onChange={(event) => setTypedSlug(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    loading={pending}
                    disabled={typedSlug !== slug}
                    onClick={onToggleActive}
                  >
                    Deactivate {slug}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="destructive" className="mt-3" onClick={() => setConfirming(true)}>
                Deactivate…
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-[11.5px] text-text-dim">
              Sign-in is currently refused for every user of this tenant. Reactivating restores
              access immediately; there is nothing to restore.
            </p>
            <Button className="mt-3" loading={pending} onClick={onToggleActive}>
              Reactivate {slug}
            </Button>
          </>
        )}

        <p role="alert" aria-live="polite" className="mt-2 min-h-[18px] text-[12px] text-danger">
          {error}
        </p>
      </div>
    </div>
  );
}
