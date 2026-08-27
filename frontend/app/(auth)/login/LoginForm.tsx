"use client";

import { Button, Input } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useToast } from "@/components/Toast";
import {
  DEMO_ACCOUNTS,
  findAccountByEmail,
  landingPathFor,
  signInAs,
  type DemoAccount,
} from "@/lib/demo-auth";

/**
 * Login form (docs/05-UI-UX-DESIGN.md §8: email + password, tenant-branded).
 *
 * The form, its markup, its `aria-live` error region and its pending state
 * are the migrated originals. What changed is only what happens on submit:
 *
 *   /client:  POST /api/auth/login -> scrypt verify -> HS256 cookies
 *   here:     match the email to a demo account -> cookie -> redirect
 *
 * No backend call, no database, and — per the brief — the user is never
 * stuck on this screen: an email that matches no demo account still signs in
 * as the Customer persona, with the toast saying so.
 *
 * The account picker below the form is new, and is the whole point of demo
 * mode: it is how you see the portal as each of the six roles that actually
 * exist in this project.
 *
 * TODO(BACKEND):
 * Replace the mock authentication with the real login API.
 * Expected endpoint: POST /api/auth/login
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const enter = React.useCallback(
    (account: DemoAccount) => {
      setPending(true);
      signInAs(account);
      toast({
        title: "Logged in using demo mode.",
        description: `Signed in as ${account.label} (${account.email}). No password was checked — backend authentication is pending.`,
        tone: "info",
      });

      // A `next` target only applies when it is a path this persona can
      // actually open; otherwise send them to their own plane's landing
      // screen rather than to a 403.
      const landing = landingPathFor(account);
      const target = nextPath && nextPath !== "/" ? nextPath : landing;
      router.replace(target);
      router.refresh();
    },
    [nextPath, router, toast],
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const account = findAccountByEmail(email) ?? DEMO_ACCOUNTS[0];
    enter(account);
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
            defaultValue={DEMO_ACCOUNTS[0].email}
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
            defaultValue="demo"
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

      <section
        aria-labelledby="demo-accounts"
        className="rounded-md border border-info-border bg-info-subtle p-3"
      >
        <h2 id="demo-accounts" className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-info">
          Demo mode — pick a role
        </h2>
        <p className="mt-1 text-[11.5px] text-text-mid">
          Backend authentication is pending, so any password works. These are the six roles this
          portal actually has.
        </p>

        <ul className="mt-2.5 flex flex-col gap-1">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => enter(account)}
                className="flex w-full flex-col items-start rounded-sm border border-transparent bg-surface px-2.5 py-2 text-left transition-colors duration-micro ease-portal hover:border-primary hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="text-[12.5px] font-semibold text-text">{account.label}</span>
                <span className="text-[11.5px] text-text-dim">{account.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
