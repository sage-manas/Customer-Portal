"use client";

import { Button, Input } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Login form (docs/05-UI-UX-DESIGN.md §8: email + password, tenant-branded).
 *
 * Errors follow the doc §11 pattern (what happened + what to do) and are
 * announced via `aria-live` — a failed sign-in that only changes colour is
 * invisible to a screen-reader user (docs/05 §9).
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Something went wrong. Try again.");
      setPending(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
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
  );
}
