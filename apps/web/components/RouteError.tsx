"use client";

import { Button } from "@cc/ui";
import { AlertTriangle } from "lucide-react";
import * as React from "react";

/**
 * The shared body of every route-group error boundary.
 *
 * This is the *unexpected* path only — an expected SAP outage is handled in
 * the page by `safeRead` so the screen survives. Anything reaching here is a
 * defect, so it says so plainly and offers `reset()` rather than pretending
 * the data will differ on a reload.
 *
 * `error.message` is intentionally not rendered: Next strips Server
 * Component messages to a generic string in production, so printing it shows
 * users a placeholder. The digest is what actually correlates to the server
 * log, so that is what is shown.
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong on this screen",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      role="alert"
      className="flex flex-col items-center rounded-md border border-border bg-surface p-10 text-center shadow-sm"
    >
      <AlertTriangle aria-hidden className="size-8 text-danger" strokeWidth={1.5} />
      <h2 className="mt-3 text-[14px] font-bold text-text">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-text-dim">
        The rest of the portal is unaffected — use the navigation to carry on, or try this screen
        again.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-text-dim">Reference: {error.digest}</p>
      ) : null}
      <Button variant="secondary" className="mt-4" onClick={() => reset()}>
        Try again
      </Button>
    </section>
  );
}
