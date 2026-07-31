import { redirect } from "next/navigation";

import { LoginForm } from "./LoginForm";

import { getOperatorSession } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [session, params] = await Promise.all([getOperatorSession(), searchParams]);

  const nextPath =
    params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  if (session) redirect(nextPath);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-7 shadow-md">
        <div className="mb-6 flex flex-col gap-1">
          <span className="text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
            CustomerConnect
          </span>
          <h1 className="text-xl font-bold text-text">Operator console</h1>
          <p className="text-[12.5px] text-text-dim">
            Platform-plane sign-in — not a tenant login.
          </p>
        </div>

        <LoginForm nextPath={nextPath} />
      </div>
    </main>
  );
}
