import Link from "next/link";

/**
 * The tab strip the AP and AR workspaces share (doc 09 §3.4).
 *
 * Plain links with a `?tab=` search param rather than client state, so each
 * view is a server render that fetches only what it shows — the AR desk has
 * six of them, and loading every register on every visit would make the
 * cheapest tab pay for the most expensive one.
 *
 * These are *views within one permission*, not routes with permissions of
 * their own: `/admin/ap` is `finance:ap` whole, and the guard is the page's
 * single check. A tab is presentation, exactly as a nav item is (CLAUDE.md
 * rule 5).
 */

export interface WorkspaceTab {
  key: string;
  label: string;
  /** Shown as a count chip when the view has a backlog worth flagging. */
  badge?: number;
}

export function WorkspaceTabs({
  basePath,
  tabs,
  active,
}: {
  basePath: string;
  tabs: readonly WorkspaceTab[];
  active: string;
}) {
  return (
    <nav aria-label="Workspace views" className="flex flex-wrap gap-1 border-b border-border pb-px">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`${basePath}?tab=${tab.key}`}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "-mb-px border-b-2 border-primary px-3 py-2 text-[12.5px] font-semibold text-text"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-[12.5px] text-text-mid hover:text-text"
            }
          >
            {tab.label}
            {tab.badge ? (
              <span className="ml-1.5 rounded-full bg-background px-1.5 py-0.5 text-[10.5px] tabular-nums text-text-dim">
                {tab.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Narrows a `?tab=` search param to a known view, defaulting to the first. */
export function resolveTab<T extends string>(
  value: string | string[] | undefined,
  tabs: readonly T[],
): T {
  const requested = Array.isArray(value) ? value[0] : value;
  return tabs.find((tab) => tab === requested) ?? tabs[0]!;
}
