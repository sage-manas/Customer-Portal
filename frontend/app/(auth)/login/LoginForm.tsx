"use client";

import { Button, Input } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useToast } from "@/components/Toast";
import { landingPathFor, signIn, signInAsRole } from "@/lib/auth-client";
import { DEV_ACCOUNTS, type DevAccount } from "@/lib/dev-accounts";

/**
 * Login form (docs/05-UI-UX-DESIGN.md §8: email + password, tenant-branded).
 *
 * The markup, the `aria-live` error region and the pending state are the
 * migrated originals, unchanged. What changed is what submit does: it now
 * POSTs to /api/auth/login, which verifies a scrypt hash against the user
 * table and sets HttpOnly session cookies.
 *
 * Two behaviours from demo mode are deliberately gone, because they were
 * demo-mode behaviours and this is now a real login:
 *   - an unrecognised email no longer signs in as "the customer persona"; it
 *     is refused, with the same message a wrong password gets,
 *   - the password field is no longer prefilled.
 *
 * The role picker survives only in development, where it is the fastest way to
 * check six roles' access rules. It bypasses no guard: it signs in for real and
 * every permission check applies to the session it creates.
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const showDevAccounts = process.env.NODE_ENV === "development";

  const land = React.useCallback(
    (roles: DevAccount["roles"]) => {
      // A `next` target only applies when it is a path this role can actually
      // open; otherwise send them to their own plane's landing screen rather
      // than to a 403.
      const landing = landingPathFor(roles);
      router.replace(nextPath && nextPath !== "/" ? nextPath : landing);
      router.refresh();
    },
    [nextPath, router],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    try {
      const result = await signIn(
        String(form.get("email") ?? ""),
        String(form.get("password") ?? ""),
      );
      if (result.mustChangePassword) {
        toast({
          title: "Set a new password",
          description: "You're signed in, but your password needs changing.",
          tone: "info",
        });
      }
      land(result.user.roles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't sign you in.");
      setPending(false);
    }
  }

  async function enterAs(account: DevAccount) {
    setError(null);
    setPending(true);
    try {
      const result = await signInAsRole(account.email);
      toast({
        title: `Signed in as ${account.label}.`,
        description: "Navigation and page access follow this role's permissions.",
        tone: "info",
      });
      land(result.user.roles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't sign you in.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[12.5px] font-medium text-text-mid">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[12.5px] font-medium text-text-mid">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>

        <p
          id="login-error"
          role="alert"
          aria-live="polite"
          className="min-h-[18px] text-[12px] text-danger"
        >
          {error}
        </p>

        <Button type="submit" loading={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {showDevAccounts ? (
        <section
          aria-labelledby="dev-accounts"
          className="rounded-md border border-info-border bg-info-subtle p-3"
        >
          <h2
            id="dev-accounts"
            className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-info"
          >
            Development — pick a role
          </h2>
          <p className="mt-1 text-[11.5px] text-text-mid">
            Signs in as a seeded account without a password. Available in development only; every
            permission check still applies.
          </p>

          <ul className="mt-2.5 flex flex-col gap-1">
            {DEV_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void enterAs(account)}
                  className="flex w-full flex-col items-start rounded-sm border border-transparent bg-surface px-2.5 py-2 text-left transition-colors duration-micro ease-portal hover:border-primary hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                >
                  <span className="text-[12.5px] font-semibold text-text">{account.label}</span>
                  <span className="text-[11.5px] text-text-dim">{account.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
