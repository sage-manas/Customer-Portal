import Link from "next/link";

/** 403 — no permission (docs/05-UI-UX-DESIGN.md §8). */
export default function ForbiddenPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-md">
        <h1 className="text-xl font-bold text-text">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-[12.5px] text-text-dim">
          Your account doesn&apos;t include this permission. Contact your administrator if you need
          it.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block text-[12.5px] font-medium text-primary hover:underline"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
