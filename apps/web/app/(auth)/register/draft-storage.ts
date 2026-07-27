/**
 * Where the applicant's draft handle lives between visits.
 *
 * The draft token is a bearer credential for one application, so it is kept
 * in `localStorage` on the applicant's own device and sent as a header —
 * never put in the URL, where it would leak through the address bar,
 * `Referer`, bookmarks and shared links (docs/DECISIONS.md ADR-009).
 */

const KEY = "cc.onboarding.draft";

export interface DraftHandle {
  applicationId: string;
  draftToken: string;
  tenantSlug: string;
}

export function readDraftHandle(tenantSlug: string): DraftHandle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftHandle>;
    if (!parsed.applicationId || !parsed.draftToken) return null;
    // A handle from another tenant's portal is not ours to use.
    if (parsed.tenantSlug !== tenantSlug) return null;
    return parsed as DraftHandle;
  } catch {
    return null;
  }
}

export function writeDraftHandle(handle: DraftHandle): void {
  window.localStorage.setItem(KEY, JSON.stringify(handle));
}

export function clearDraftHandle(): void {
  window.localStorage.removeItem(KEY);
}
