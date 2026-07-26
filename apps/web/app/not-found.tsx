import Link from "next/link";

/**
 * 404 (docs/05-UI-UX-DESIGN.md §8). Deliberately identical for "no such
 * document" and "document belongs to another tenant" — the portal never
 * leaks existence.
 */
export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-lg border border-border bg-surface p-8 text-center shadow-md">
        <h1 className="text-xl font-bold text-text">We couldn&apos;t find that</h1>
        <p className="mt-2 text-[12.5px] text-text-dim">
          The page or document doesn&apos;t exist, or it isn&apos;t available on this portal.
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
