import { CloudOff } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Shown in place of a screen's data when SAP cannot be reached.
 *
 * Deliberately not a toast and not a full-page error: the shell, the nav and
 * every other module stay usable, because one unreachable read does not mean
 * the portal is down. Mirrors StaleDataBanner's tone — this is the harder
 * case of the same story.
 */
export function SapUnavailable({ reason, className }: { reason?: string; className?: string }) {
  return (
    <section
      role="alert"
      className={cn(
        "flex flex-col items-center rounded-md border border-border bg-surface p-10 text-center shadow-sm",
        className,
      )}
    >
      <CloudOff aria-hidden className="size-8 text-text-dim" strokeWidth={1.5} />
      <h2 className="mt-3 text-[14px] font-bold text-text">This data is temporarily unavailable</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-text-dim">
        {reason ?? "We couldn't reach SAP just now."} Nothing you&apos;ve saved is affected — try
        again in a moment.
      </p>
    </section>
  );
}
