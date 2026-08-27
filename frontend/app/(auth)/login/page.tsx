import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "./LoginForm";

import { getSession } from "@/lib/session";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Login screen (docs/05-UI-UX-DESIGN.md §8). Tenant-branded: the tenant is
 * resolved from the host, so the customer sees who they are signing in to
 * before they type anything. MFA (per tenant policy) is a later phase.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [session, tenant, params] = await Promise.all([
    getSession(),
    resolveRequestTenant(),
    searchParams,
  ]);

  // Only same-origin paths are accepted as a return target — an open
  // redirect on a login page is a phishing primitive.
  const nextPath =
    params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  if (session) redirect(nextPath);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-7 shadow-md">
        <div className="mb-6 flex flex-col gap-1">
          <span className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
            {tenant?.name ?? "CustomerConnect"}
          </span>
          <h1 className="text-xl font-bold text-text">Sign in</h1>
          <p className="text-[12.5px] text-text-dim">
            Use the email address your account was created with.
          </p>
        </div>

        <LoginForm nextPath={nextPath} />

        <p className="mt-5 border-t border-border pt-4 text-[12px] text-text-dim">
          New customer?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Register your company
          </Link>
        </p>
      </div>
    </main>
  );
}
