import { redirect } from "next/navigation";

/**
 * The exception tray moved into the AP workspace in Phase 6 (doc 09 §3.4,
 * ADR-060): gateway-side money movement is AP's desk, and `exceptions:view`
 * has sat in the AP permission group since Phase 1.
 *
 * The old path stays as a redirect rather than being deleted. It is in
 * people's bookmarks and in runbooks (`docs/runbooks`), and a 404 for an
 * operator chasing a stuck payment is a worse outcome than a hop.
 */
export default function ExceptionsRedirectPage() {
  redirect("/admin/ap?tab=reconciliation");
}
