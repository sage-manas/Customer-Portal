"use client";

import { UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useToast } from "./Toast";

import { landingPathFor, signInAsRole } from "@/lib/auth-client";
import { DEV_ACCOUNTS, type DevAccount } from "@/lib/dev-accounts";

/**
 * Development role switcher.
 *
 * Scaffolding, not product UI: it exists so the whole role-based experience can
 * be checked without signing out and back in six times. It bypasses nothing —
 * it performs a real sign-in as another seeded account and reloads, so every
 * guard, nav filter and 403 applies to the new session exactly as it would
 * after a normal login.
 *
 * Two things changed when real authentication landed. The session cookie is
 * `HttpOnly`, so this component can no longer read who is signed in — the
 * active label is passed down from the server instead. And the endpoint behind
 * it does not exist outside development, so the control renders only there.
 */
export function RoleSwitcher({ activeEmail }: { activeEmail?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  if (process.env.NODE_ENV !== "development") return null;

  const active = DEV_ACCOUNTS.find((account) => account.email === activeEmail);

  async function enterAs(account: DevAccount) {
    setPending(true);
    try {
      await signInAsRole(account.email);
      setOpen(false);
      toast({
        title: `Now viewing as ${account.label}.`,
        description: "Navigation and page access follow this role's permissions.",
        tone: "info",
      });
      router.replace(landingPathFor(account.roles));
      router.refresh();
    } catch (cause) {
      toast({
        title: "Couldn't switch role",
        description: cause instanceof Error ? cause.message : "Please try again.",
        tone: "error",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed bottom-4 left-4 z-[90] print:hidden">
      {open ? (
        <div
          role="dialog"
          aria-label="Switch role"
          className="mb-2 w-72 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          <p className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
            Development role
          </p>
          <ul className="max-h-80 overflow-y-auto py-1">
            {DEV_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void enterAs(account)}
                  aria-current={account.email === activeEmail ? "true" : undefined}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-[12.5px] hover:bg-primary-subtle disabled:opacity-60 ${
                    account.email === activeEmail ? "bg-primary-subtle text-primary" : "text-text"
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
        Role: {active?.label ?? "none"}
      </button>
    </div>
  );
}
