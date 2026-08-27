"use client";

import { NavItemContent, type NavLinkRenderArgs } from "@cc/ui";
import Link, { useLinkStatus } from "next/link";

/**
 * The sidebar's nav link for this app: a `next/link`, so moving between
 * modules is a client transition rather than a document load.
 *
 * `@cc/ui` deliberately knows nothing about Next (Storybook renders the same
 * shell), so it asks for a link renderer instead — this is the one apps/web
 * supplies, via `AppShellClient`.
 *
 * The pending marker lives in a child component because `useLinkStatus`
 * only reports the pending navigation of its nearest ancestor `<Link>`: it
 * has to be called from inside the link it labels, not from `Sidebar`.
 */
export function navLink({ item, isActive, collapsed, className, title }: NavLinkRenderArgs) {
  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      title={title}
      className={className}
    >
      <PendingAwareContent item={item} collapsed={collapsed} />
    </Link>
  );
}

function PendingAwareContent({
  item,
  collapsed,
}: {
  item: NavLinkRenderArgs["item"];
  collapsed: boolean;
}) {
  const { pending } = useLinkStatus();
  return <NavItemContent item={item} collapsed={collapsed} pending={pending} />;
}
