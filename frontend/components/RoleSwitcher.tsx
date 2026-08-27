"use client";

import { UserCog } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { useToast } from "./Toast";

import { DEMO_ACCOUNTS, landingPathFor, readDemoAccountId, signInAs } from "@/lib/demo-auth";

/**
 * Development role switcher.
 *
 * Phase-1 scaffolding, not product UI: it exists so the whole role-based
 * experience can be checked without signing out and back in six times. It
 * does not bypass any restriction — it re-signs-in as another demo persona
 * and reloads, so every guard, nav filter and 403 applies to the new session
 * exactly as it would after a real login.
 *
 * Mounted in the three shells (portal, admin, console). Delete it with the
 * rest of demo mode when real authentication arrives.
 */
/**
 * Nothing pushes cookie changes at us, and every write in this app is
 * followed by a `router.refresh()`, so the subscription is a no-op — the
 * snapshot is re-read on each render pass that a navigation causes.
 */
function subscribeToPathname(): () => void {
  return () => {};
}

export function RoleSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  // The cookie is an external store, so it is read as one: `useSyncExternalStore`
  // gives the server snapshot (null) on the first pass and the real value after
  // hydration, without an effect that would flash the wrong label.
  const activeId = React.useSyncExternalStore(
    subscribeToPathname,
    readDemoAccountId,
    () => null,
  );
  // `pathname` is read so the label re-evaluates after a navigation.
  void pathname;

  const active = DEMO_ACCOUNTS.find((account) => account.id === activeId);

  return (
    <div className="fixed bottom-4 left-4 z-[90] print:hidden">
      {open ? (
        <div
          role="dialog"
          aria-label="Switch demo role"
          className="mb-2 w-72 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          <p className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
            Demo role
          </p>
          <ul className="max-h-80 overflow-y-auto py-1">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => {
                    signInAs(account);
                    setOpen(false);
                    toast({
                      title: `Now viewing as ${account.label}.`,
                      description: "Navigation and page access follow this role's permissions.",
                      tone: "info",
                    });
                    router.replace(landingPathFor(account));
                    router.refresh();
                  }}
                  aria-current={account.id === activeId ? "true" : undefined}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-[12.5px] hover:bg-primary-subtle ${
                    account.id === activeId ? "bg-primary-subtle text-primary" : "text-text"
                  }`}
                >
                  <span className="font-semibold">{account.label}</span>
                  <span className="text-[11px] text-text-dim">{account.roles.join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-2 text-[11.5px] font-medium text-text-mid shadow-md hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <UserCog aria-hidden className="size-3.5" strokeWidth={1.75} />
        Demo role: {active?.label ?? "none"}
      </button>
    </div>
  );
}
