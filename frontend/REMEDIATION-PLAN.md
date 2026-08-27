# Frontend Remediation Plan

**Status: proposed.** Seven gaps found in the Phase 1 frontend, ranked by user impact.
Each was reproduced against a production build (`next build` + `next start`), not inferred
from reading code. Every fix below is written against **Next 16.3.1** APIs as documented in
`node_modules/next/dist/docs/` — see [§10 Next 16 API notes](#10-next-16-api-notes) for the
renames that break code copied from Next 15 tutorials.

| # | Gap | Impact | Effort | Priority |
| --- | --- | --- | --- | --- |
| 1 | No error boundaries — SAP outage returns a bare white 500 on every route | **Critical** | ~4h | P0 |
| 2 | No `loading.tsx` / `Suspense` — navigation gives zero feedback | **High** | ~3h | P0 |
| 3 | `latencyMs` knob wired nowhere — all loading UI is unexercised | Medium | ~1h | P1 |
| 4 | No pagination — catalogue hard-capped at 24 items | **High** (post-backend) | ~6h | P1 |
| 5 | Typeahead ships the entire material master to the client | Medium (scales badly) | ~3h | P1 |
| 6 | `ProductGrid` fires one request per card (N+1) | Low now, couples to #4 | ~2h | P2 |
| 7 | Zero automated tests across 41k LOC | Medium | ~8h | P2 |

**Total: ~27h.** Gaps 1–2 are the ones that make the app look broken to a real user and
should land together.

---

## 1. Error boundaries

### Symptom

With SAP unreachable, **every page in the portal** returns HTTP 500 and renders Next's raw
error document — no shell, no nav, no branding, no route out.

### Reproduction

```ts
// packages/services/_demo.ts
globalForDemo.__ccDemoSap ??= new MockSapAdapter({ today: DEMO_TODAY, unavailable: true });
```

```
npx next build && npx next start -p 3132
```

| Route | Status | Rendered |
| --- | --- | --- |
| `/catalogue` | 500 | "This page couldn't load" (Next default) |
| `/orders` | 500 | same |
| `/invoices` | 500 | same |
| `/` | 500 | same |

### Root cause

Two distinct problems that need two distinct fixes:

1. **No `error.tsx` exists anywhere in `app/`.** An uncaught throw propagates to the
   framework default.
2. **A SAP outage is not an unexpected error — it is an expected operating condition**, and
   the service layer already models it (`toCatalogueError` maps it to `upstream_unavailable`
   / 502). Routing an expected condition through an error boundary is the wrong shape: the
   boundary discards the whole page, when what the user needs is the page with a banner on
   it.

### Why "just add `error.tsx`" does not fix this — measured, not assumed

A prototype of the fix was built and tested against a production build with
`unavailable: true`. An `error.tsx` was placed at `app/(portal)/error.tsx` and the two
failure paths were measured separately:

| Scenario | `error.tsx` catches it? | What the user gets |
| --- | --- | --- |
| **Initial document request** (direct URL, hard reload, first visit) | **No** | HTTP 500, bare Next error document, no shell |
| **Client-side navigation** (clicking a nav link) | **Yes** | Boundary renders *inside* the shell, nav stays intact |

This is consistent with Next's documented model. The error-handling guide's prescription for
a failed Server Component read is not the boundary at all — it is to handle it in the page:

> ### Server Components
> When fetching data inside of a Server Component, you can use the response to conditionally
> render an error message or `redirect`.
> ```tsx
> if (!res.ok) {
>   return 'There was an error.'
> }
> ```

**Conclusion: Layer 1 is mandatory, Layer 2 is a genuine but partial complement.** A plan
that ships only `error.tsx` still returns 500 to anyone who opens a URL directly or reloads
during an outage — which is most of them.

A second constraint rules out the other naive variant. Per
`docs/01-app/03-api-reference/03-file-conventions/error.md`:

> During development, the `Error` object forwarded to the client will be serialized and
> include the `message` of the original error for easier debugging. However, **this behavior
> is different in production**. […] Errors forwarded from Server Components show a generic
> message with an identifier.

So **`error.tsx` cannot branch on `error.message` in production** — the message is stripped.
By the time the boundary runs, the information needed to write "SAP is unreachable" is gone.

### The fix — two layers

**Layer 1 (primary): catch expected failures in the page and render a degraded view.**

Add `lib/safe-read.ts`.

**Do not test this with `isSapError`.** A `SapError` never reaches the page: every service
catches it at its own boundary and re-throws its own type — `browseCatalogue` ends with
`throw toCatalogueError(error)`, which produces a `CatalogueError` carrying
`code: "upstream_unavailable"` and `status: 502`. By the time a page sees the throw, it is a
`DemoServiceError` subclass, and `isSapError(error)` is `false`. A guard written against
`SapError` would compile, never fire, and leave the 500 exactly as it is today.

The discriminator is therefore the service-level `code`/`status` contract, which is uniform:
every service error in `packages/services/*` extends the same `DemoServiceError` base:

```ts
/**
 * Wraps a service read so an *expected* upstream failure degrades the screen
 * instead of destroying it.
 *
 * A reachability failure is not a bug — docs/05 P7 requires the screen to
 * stay browsable and say so. Only that class is swallowed: a programming
 * error still throws, and still reaches the boundary in §1 Layer 2, because
 * silently rendering "SAP is down" over a genuine defect is how a defect
 * survives to production.
 *
 * Matched structurally on `code`/`status` rather than with `instanceof`.
 * Every service defines its own error class over one shared
 * `DemoServiceError` base, and there is no cross-service type guard to
 * import — but the `upstream_unavailable` / 502 contract is common to all of
 * them, and is what the real @cc/service-* packages restore too. That makes
 * this the one check that survives the backend swap unchanged.
 */
interface UpstreamFailure {
  code?: string;
  status?: number;
}

export async function safeRead<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    const failure = error as UpstreamFailure;
    const unreachable =
      failure?.code === "upstream_unavailable" || failure?.status === 502 || failure?.status === 503;

    if (unreachable) {
      return { ok: false, reason: "We couldn't reach SAP just now." };
    }
    throw error;
  }
}
```

> Underneath, `SapError.retryable` is a real non-optional boolean that defaults to
> `kind === "unavailable"` — that is what each service consults before mapping to
> `upstream_unavailable`. The mapping already exists; this helper only reads its output.

Then in a page — `app/(portal)/catalogue/page.tsx`:

```tsx
const result = await safeRead(() =>
  browseCatalogue(sap, {
    search: single("q"),
    materialGroup: single("group"),
    plant: single("plant"),
    limit: PAGE_SIZE,
  }),
);

if (!result.ok) {
  return (
    <>
      <PageHeader title="Catalogue" subtitle="Your catalogue, at your contracted prices." />
      <SapUnavailable reason={result.reason} />
    </>
  );
}
```

Add the shared notice at `packages/ui/components/SapUnavailable.tsx` and export it from
`packages/ui/index.ts`:

```tsx
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
```

Apply `safeRead` to **every** page that reads a service — all 50 `force-dynamic` routes.
That is the bulk of the 4h estimate, and it is the part that actually removes the 500s.

**Layer 2 (backstop): route-group error boundaries for client-side navigation and genuine
defects.**

Per the table above this covers client-side navigations and post-hydration failures — real
value, but it is not what fixes the outage. Ship it *with* Layer 1, never instead of it.

Create `components/RouteError.tsx`:

```tsx
"use client";

import { Button } from "@cc/ui";
import { AlertTriangle } from "lucide-react";
import * as React from "react";

/**
 * The shared body of every route-group error boundary.
 *
 * This is the *unexpected* path only — an expected SAP outage is handled in
 * the page by `safeRead` so the screen survives. Anything reaching here is a
 * defect, so it says so plainly and offers `retry()` rather than pretending
 * the data will differ on a reload.
 *
 * `error.message` is intentionally not rendered: Next strips Server
 * Component messages to a generic string in production, so printing it shows
 * users a placeholder. The digest is what actually correlates to the server
 * log, so that is what is shown.
 */
export function RouteError({
  error,
  retry,
  title = "Something went wrong on this screen",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
}) {
  React.useEffect(() => {
    // TODO(BACKEND): forward to Sentry once @cc/observability is restored.
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
        The rest of the portal is unaffected — use the navigation to carry on, or try this
        screen again.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-text-dim">Reference: {error.digest}</p>
      ) : null}
      <Button variant="secondary" className="mt-4" onClick={() => retry()}>
        Try again
      </Button>
    </section>
  );
}
```

Then three thin wrappers. Each renders **inside** its group's layout, so the shell and nav
survive:

```tsx
// app/(portal)/error.tsx
"use client";

import { RouteError } from "@/components/RouteError";

export default function PortalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
```

```tsx
// app/(admin)/admin/error.tsx
"use client";

import { RouteError } from "@/components/RouteError";

export default function AdminError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} title="This desk couldn't load" />;
}
```

```tsx
// app/(console)/error.tsx
"use client";

import { RouteError } from "@/components/RouteError";

export default function ConsoleError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} title="This console screen couldn't load" />;
}
```

**Layer 2b: `app/global-error.tsx`** — the only thing that catches a throw in the *root*
layout. It replaces the document, so it must ship its own `<html>`/`<body>` and cannot rely
on `tokens.css`:

```tsx
"use client";

/**
 * Root-layout backstop. Per Next's error.md, `error.tsx` "does not wrap the
 * layout.js or template.js above it in the same segment" — so nothing else in
 * app/ can catch a failure in the root layout.
 *
 * It replaces the document and does NOT receive global styles, so the colours
 * here are inline literals rather than design tokens. Keep it dependency-free:
 * anything it imports is another thing that can fail at the same moment.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>CustomerConnect is unavailable</h1>
          <p style={{ fontSize: 13, color: "#555", margin: "0 0 16px" }}>
            Something failed while loading the application shell.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 11, fontFamily: "monospace", color: "#888" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => retry()}
            style={{ padding: "8px 16px", fontSize: 13, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
```

### Where the boundaries do and don't reach

`error.tsx` wraps its segment's `page`, `loading`, `not-found` and **nested** layouts — but
**not the layout in its own segment**. So `app/(portal)/error.tsx` does *not* catch a throw
in `app/(portal)/layout.tsx`.

Today that is safe: the portal layout's two service calls, `getCartLineCount` and
`unreadNotificationCount`, read in-memory portal state and never touch SAP. **Keep it that
way.** When the real backend lands and those become DB reads, either wrap them in `safeRead`
with a zero fallback, or accept that a failure there takes the whole shell to
`global-error.tsx`.

### Verification

The prototype already confirmed the target behaviour on `/catalogue`. With `safeRead` applied
to that one page and the outage forced:

```
/catalogue  status=200  degraded=1  errorBoundary=0  navIntact=1   <- fixed
/orders     status=500  degraded=0  errorBoundary=0  navIntact=0   <- not yet migrated
```

So the acceptance test for this gap is simply that **no route is left in the `/orders` state**:

```
# 1. Force the outage (gap #3 makes this an env var)
CC_DEMO_SAP_DOWN=1 npx next build && CC_DEMO_SAP_DOWN=1 npx next start

# 2. Every route must return 200 with the shell + SapUnavailable, never 500.
#    Sweep them rather than spot-checking — scripts/qa/01-route-sweep.mjs
#    already enumerates every route and classifies the outcome.

# 3. Client-nav boundary: from a working page, click through to a throwing one.
#    The boundary must render inside the shell with the nav intact.

# 4. Confirm nothing was left switched on before committing.
git diff --exit-code packages/services/_demo.ts
```

---

## 2. Loading states

### Symptom

Clicking a nav item does nothing visible for the entire duration of the server render. The
user stays on the *old* page, the target nav item does not even highlight, and there is no
spinner or skeleton.

### Reproduction

With `latencyMs: 600` injected (conservative — real ECC/S4 RFC round-trips run 1–3s), the
DOM sampled during a `/catalogue` → `/orders` click:

```
  102ms  url=/catalogue  h1=Catalogue   pending=false
  212ms  url=/catalogue  h1=Catalogue   pending=false
  357ms  url=/catalogue  h1=Catalogue   pending=false
 1104ms  url=/orders     h1=Orders      pending=false
```

One full second of "the click did nothing", then an abrupt swap. Users will double-click,
and on a mutation screen that is a duplicate submit.

### Root cause

- **Zero** `loading.tsx` files and **zero** `Suspense` boundaries in the codebase.
- **50 of 55 pages** are `export const dynamic = "force-dynamic"` and `await` SAP on the
  server, so every navigation pays a full server round-trip before anything paints.

### The fix

**Step 1 — a shared skeleton.** `packages/ui/components/PageSkeleton.tsx`, exported from
`packages/ui/index.ts`:

```tsx
import { Skeleton } from "../primitives/skeleton";

/**
 * Route-level loading fallback.
 *
 * Mirrors the real page's geometry — header block, then rows — so the swap to
 * content does not shift layout. `rows` lets a list route approximate its own
 * table without every route hand-rolling a skeleton.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3.5 shadow-sm">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
```

**Step 2 — one `loading.tsx` per route group** (covers every nested route by default):

```tsx
// app/(portal)/loading.tsx  — and identical files at
// app/(admin)/admin/loading.tsx and app/(console)/loading.tsx
import { PageSkeleton } from "@cc/ui";

export default function Loading() {
  return <PageSkeleton />;
}
```

**Step 3 — override where the shape differs materially.** The catalogue is a card grid, not
a table:

```tsx
// app/(portal)/catalogue/loading.tsx
import { Skeleton } from "@cc/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading catalogue…</span>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-[68px] w-full rounded-md" />
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-52 w-full rounded-md" />
        ))}
      </section>
    </div>
  );
}
```

**Step 4 — mark the pending nav item.** A skeleton tells the user *something* is loading;
the sidebar should say *what*. In `packages/ui/layout/Sidebar.tsx`, use `useLinkStatus`
(Next 16) on each nav link, or `useSelectedLayoutSegment()` combined with `useTransition`,
to render a pending state on the clicked item. Confirm the API first:

```
grep -rn "useLinkStatus" node_modules/next/dist/docs/01-app -l
```

### Why this is cheap

`loading.tsx` is a Suspense boundary that Next **prefetches**, so the fallback paints
immediately on click. Per `docs/.../loading.md`: "Shared layouts remain interactive while new
route segments load" — the shell, nav and cart drawer stay live, which is exactly the
behaviour the persistent cart in docs/05 §7.2 assumes.

### Verification

Re-run the DOM sampler from the reproduction above with `latencyMs: 600`. The expected trace
is a skeleton within ~100ms and `pending=true` throughout:

```
  102ms  url=/orders  h1=          pending=true
  357ms  url=/orders  h1=          pending=true
 1104ms  url=/orders  h1=Orders    pending=false
```

Note the URL flips **immediately** once a boundary exists — that alone fixes the "did my
click register?" problem.

---

## 3. Wire up the latency knob

### Symptom

Every skeleton, `pricingLoading` branch and `StockChipSkeleton` in the codebase renders for
approximately zero frames. They have never been seen by anyone, and are therefore untested by
construction.

### Root cause

`MockSapOptions.latencyMs` is documented as *"Artificial round-trip latency, so
loading/skeleton states are real"* — and is **set nowhere**:

```
grep -rn "latencyMs" packages/ app lib --include=*.ts | grep -v "sap-mock/mock/driver.ts"
# (no matches)
```

`demoSapAdapter()` constructs `new MockSapAdapter({ today: DEMO_TODAY })`, taking the `?? 0`
default.

### The fix

Make it an environment knob so demos, QA and screenshots can each pick a profile.
`packages/services/_demo.ts`:

```ts
/**
 * Artificial SAP latency, in milliseconds.
 *
 * Defaults to 0 so the demo stays snappy, but QA and design review run with
 * CC_DEMO_SAP_LATENCY_MS set — without it the skeletons and pending states
 * never render long enough to be seen, let alone reviewed.
 */
const DEMO_LATENCY_MS = Number(process.env.CC_DEMO_SAP_LATENCY_MS ?? 0) || 0;

/** Forces every SAP call to fail, for exercising the §1 degradation path. */
const DEMO_SAP_DOWN = process.env.CC_DEMO_SAP_DOWN === "1";

export function demoSapAdapter(): SapAdapter {
  globalForDemo.__ccDemoSap ??= new MockSapAdapter({
    today: DEMO_TODAY,
    latencyMs: DEMO_LATENCY_MS,
    unavailable: DEMO_SAP_DOWN,
  });
  return globalForDemo.__ccDemoSap;
}
```

Add to `package.json`:

```json
"dev:slow": "cross-env CC_DEMO_SAP_LATENCY_MS=800 next dev",
"dev:down": "cross-env CC_DEMO_SAP_DOWN=1 next dev"
```

> On Windows, plain `VAR=x next dev` does not work in `cmd`/PowerShell — either add
> `cross-env` as a devDependency or document the PowerShell form
> (`$env:CC_DEMO_SAP_LATENCY_MS=800; npx next dev`).

This turns gaps 1 and 2 from "trust the plan" into two commands anyone can run.

---

## 4. Pagination

### Symptom

The catalogue shows the first 24 materials. There is no way to reach item 25 — no next page,
no infinite scroll, no "load more".

### Root cause

```
app/(portal)/catalogue/page.tsx:23:  const PAGE_SIZE = 24;
app/(portal)/catalogue/page.tsx:44:  limit: PAGE_SIZE,
```

`MaterialQuery` already carries `offset`, and `Page<T>` already carries `total` — the
contract supports paging and **no route reads either**. Invisible against 12 seeded
materials; fatal against a real material master. The same applies to orders, invoices and
deliveries.

### The fix

**Step 1 — a URL-driven pager.** Page state belongs in the URL for the same reason the
filters already do (docs/05 §6.3): a paged view is shareable and bookmarkable.

`packages/ui/components/Pager.tsx`, exported from the index:

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Offset pager for server-rendered lists.
 *
 * Offset, not cursor: the SAP reads behind these screens are `limit`/`offset`
 * against a stable-ordered set, and a customer-facing catalogue needs
 * addressable page numbers more than it needs consistency under concurrent
 * insertion.
 *
 * Emits an href per page rather than an onClick so each page is a real,
 * shareable URL and works before hydration.
 */
export function Pager({
  total,
  pageSize,
  offset,
  hrefFor,
}: {
  total: number;
  pageSize: number;
  offset: number;
  hrefFor: (offset: number) => string;
}) {
  if (total <= pageSize) return null;

  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.ceil(total / pageSize);
  const step =
    "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[12px] font-medium transition-colors";

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3.5 py-2.5 shadow-sm"
    >
      <p className="text-[11.5px] tabular-nums text-text-dim">
        {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <a href={hrefFor(offset - pageSize)} className={cn(step, "text-primary hover:bg-background")}>
            <ChevronLeft aria-hidden className="size-3.5" />
            Previous
          </a>
        ) : (
          <span aria-disabled className={cn(step, "text-text-dim opacity-50")}>
            <ChevronLeft aria-hidden className="size-3.5" />
            Previous
          </span>
        )}
        <span className="text-[11.5px] tabular-nums text-text-mid">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <a href={hrefFor(offset + pageSize)} className={cn(step, "text-primary hover:bg-background")}>
            Next
            <ChevronRight aria-hidden className="size-3.5" />
          </a>
        ) : (
          <span aria-disabled className={cn(step, "text-text-dim opacity-50")}>
            Next
            <ChevronRight aria-hidden className="size-3.5" />
          </span>
        )}
      </div>
    </nav>
  );
}
```

**Step 2 — read `offset` in the page.** In `app/(portal)/catalogue/page.tsx`:

```tsx
const offset = Math.max(0, Number(single("page") ?? 1) - 1) * PAGE_SIZE;

const result = await browseCatalogue(sap, {
  search: single("q"),
  materialGroup: single("group"),
  plant: single("plant"),
  limit: PAGE_SIZE,
  offset,
});
```

and below the grid:

```tsx
<Pager
  total={result.page.total}
  pageSize={PAGE_SIZE}
  offset={offset}
  hrefFor={(next) => {
    const query = new URLSearchParams();
    for (const key of ["q", "group", "plant"]) {
      const value = single(key);
      if (value) query.set(key, value);
    }
    query.set("page", String(Math.floor(next / PAGE_SIZE) + 1));
    return `/catalogue?${query}`;
  }}
/>
```

**Step 3 — reset to page 1 when a filter changes.** In `CatalogueFilters.apply`, delete the
`page` param whenever any other filter moves, or the user lands on page 7 of a 2-page result:

```ts
const apply = (key: string, value: string | undefined) => {
  const next = new URLSearchParams(params.toString());
  if (value) next.set(key, value);
  else next.delete(key);
  // A changed filter yields a different result set, so the old page number is
  // meaningless — and often out of range.
  next.delete("page");
  router.push(`/catalogue?${next.toString()}`);
};
```

**Step 4 — repeat for the other lists**: orders, invoices, deliveries, quotations,
inquiries, support. Each already renders a full unbounded read today.

---

## 5. Typeahead scaling (debt introduced by the search feature)

### Symptom

`app/(portal)/catalogue/page.tsx` performs a second, **unfiltered** `browseCatalogue` and
serialises every material into the RSC payload so `MaterialSearchBox` can filter client-side.
Against 12 seeded materials this is free. Against a 10,000-line material master it is
megabytes on **every catalogue render**, and it grows with the customer's catalogue.

It also silently depends on gap #4 being unfixed — it only works because there is no real
paging behind it.

### Root cause

A deliberate Phase 1 shortcut: with no search endpoint available, filtering a client-side
dump was the only way to get instant match-code behaviour. That trade must not survive
contact with a real backend.

### The fix

Replace the client-side filter with a **debounced server search**, keeping the exact same UI.

**Step 1 — expose a search route.** `lib/demo-api.ts` already routes
`catalogue/materials/:matnr/availability`; add a sibling in the same catalogue section:

```ts
if (head === "catalogue" && rest[0] === "materials" && rest[1] === "search") {
  require("catalogue:view");
  const term = (body.q as string | undefined)?.trim() ?? "";
  // An empty term must return nothing, not the whole master.
  if (!term) return json({ materials: [] });
  return json({ materials: await catalogue.searchMaterials(adapter, term, 12) });
}
```

**Step 2 — implement the search in the service**, so the matching rules live server-side
where the real SAP query will eventually run. `packages/services/catalogue.ts`:

```ts
/**
 * Match-code search over MATNR / MAKTX / MATKL, capped.
 *
 * The rules live here rather than in the browser because they are the query
 * — when this is repointed at the real adapter, `search` becomes an SAP
 * selection and the shape of the response must not change.
 *
 * TODO(BACKEND): push the matching into adapter.getMaterials so SAP does the
 * selection instead of filtering a fetched page.
 */
export async function searchMaterials(
  adapter: SapAdapter,
  term: string,
  limit = 12,
): Promise<Material[]> {
  const read = await adapter.getMaterials({ search: term, limit });
  return read.data.items;
}
```

**Step 3 — make the box fetch.** In `MaterialSearchBox`, replace the `materials` prop and the
`useMemo` filter with a debounced request:

```tsx
const [hits, setHits] = React.useState<MaterialSuggestion[]>([]);

React.useEffect(() => {
  if (!query) {
    setHits([]);
    return;
  }
  const controller = new AbortController();
  // 200ms is below the threshold where a hit list feels laggy, and high
  // enough that a typed word costs one request rather than one per keystroke.
  const timer = setTimeout(() => {
    demoFetch("/api/catalogue/materials/search", {
      method: "POST",
      body: JSON.stringify({ q: query }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { materials: [] }))
      .then((body) => setHits(body.materials ?? []))
      // An aborted or failed lookup leaves the last hit list up rather than
      // flashing "no matches" at someone who is still typing.
      .catch(() => {});
  }, 200);

  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}, [query]);
```

**Step 4 — delete the dump.** Remove the `suggestions` array and the second
`browseCatalogue` call from `page.tsx`, and the `materials` prop from `CatalogueFilters`.

**Also fix while here:** `page.tsx` currently calls `browseCatalogue` **twice** per render —
once filtered, once unfiltered — purely to derive the material-group dropdown options. Once
the unfiltered read is no longer needed for suggestions, replace it with a dedicated
`listMaterialGroups(adapter)` that returns just the distinct MATKL values.

---

## 6. Per-card availability requests (N+1)

### Symptom

`ProductGrid` mounts one `LazyProductCard` per material, and each fires its own
`/availability` request. A 24-card page is 24 parallel requests.

### Assessment

This is **deliberate and documented** — the comment in `ProductGrid.tsx` is explicit that a
slow condition record should delay its own card, not the grid, per docs/05 §7.2. At 24 cards
it is defensible.

The risk is coupling: the moment gap #4 makes page size configurable, someone will raise it
to 100 and this becomes 100 requests per page view.

### The fix (do this with #4, not before)

Add a batch endpoint and keep the per-card skeleton behaviour:

```
POST /api/catalogue/availability   { materials: string[], plant?: string }
  -> { availability: Record<string, Availability> }
```

Have `ProductGrid` issue **one** request for the visible page on mount, then feed each card
from the result via context, preserving each card's independent skeleton. Cards whose entry
has not arrived keep showing `pricingLoading`, so the staggered-reveal UX is unchanged.

Guard the page size regardless:

```ts
const PAGE_SIZE = Math.min(Number(process.env.CC_CATALOGUE_PAGE_SIZE ?? 24), 48);
```

---

## 7. Automated tests

### Symptom

No `*.test.*` or `*.spec.*` anywhere in 41k LOC. `playwright` is a devDependency with no
config; `scripts/qa/*.mjs` are ad-hoc sweeps run by hand.

### The fix — three tiers, in this order

**Tier 1 — pure domain logic (highest value per hour).** `packages/domain` is pure functions
with no I/O: `hasPermission`, `visibleNavItems`, `sessionPlane`, `stockAvailability`,
`totalStock`, the status registries. Add Vitest:

```
npm i -D vitest @vitejs/plugin-react jsdom
```

```ts
// vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, include: ["**/*.test.ts?(x)"] },
  resolve: {
    alias: {
      "@cc/domain": new URL("./packages/domain/index.ts", import.meta.url).pathname,
      "@cc/ui": new URL("./packages/ui/index.ts", import.meta.url).pathname,
      "@": new URL("./", import.meta.url).pathname,
    },
  },
});
```

Start with the permission matrix — it is the security control, it is pure, and a regression
there is a data-exposure bug:

```ts
// packages/domain/permissions.test.ts
import { describe, expect, it } from "vitest";

import { hasPermission } from "./index";

describe("hasPermission", () => {
  it("refuses admin:view to a plain customer", () => {
    expect(hasPermission({ roles: ["customer"] }, "admin:view")).toBe(false);
  });

  it("refuses platform:operate to a tenant admin", () => {
    expect(hasPermission({ roles: ["client_admin"] }, "platform:operate")).toBe(false);
  });
});
```

**Tier 2 — the matching rules just added.** `MaterialSearchBox`'s `matches()` is pure; export
it and pin the behaviour, including the regressions already fixed by hand:

```ts
it("matches a material code by its numeric tail", () => {
  expect(matches(item, "10001")).toBe(true); // substring, not prefix
});

it("matches across the separator", () => {
  expect(matches(item, "MAT10")).toBe(true);
});

it("does not match everything on punctuation", () => {
  expect(matches(item, "-")).toBe(false); // the includes("") trap
});
```

**Tier 3 — promote the QA sweeps to real Playwright specs.** `scripts/qa/helpers.mjs` already
has `loginAs`, `trackErrors` and `classify` — it is a test harness without a runner. Add
`playwright.config.ts` with a `webServer` block, move the three sweeps to `e2e/*.spec.ts`,
and add the two regression cases this review produced:

```ts
test("survives a SAP outage without a 500", async ({ page }) => {
  // run with CC_DEMO_SAP_DOWN=1
});

test("shows a skeleton during a slow navigation", async ({ page }) => {
  // run with CC_DEMO_SAP_LATENCY_MS=800
});
```

Gap #3 is what makes both of these expressible as tests at all.

---

## 8. Suggested sequencing

| Phase | Contents | Why this order |
| --- | --- | --- |
| **A** (~1 day) | #3 latency/outage knobs → #1 error handling → #2 loading states | #3 first because it is the harness that makes #1 and #2 observable and reviewable. #1 and #2 ship together — they are the two halves of "the app behaves when SAP is slow or down". |
| **B** (~1.5 days) | #4 pagination → #5 server-side search → #6 batch availability | Strictly ordered: #5 removes the full-catalogue dump that #4 would otherwise multiply, and #6 only matters once #4 makes page size a real variable. |
| **C** (~1 day) | #7 tests, tiers 1→3 | Last by sequence, not by importance — tiers 2 and 3 can only pin behaviour that phases A and B have settled. |

---

## 9. Verification checklist

Run before considering any phase complete:

```
npx tsc --noEmit                    # must be clean
npx eslint .                        # 0 errors (8 pre-existing warnings are documented)
npx next build                      # must succeed
npm run smoke                       # 34/34 write-path checks

# Phase A additions
CC_DEMO_SAP_DOWN=1 npx next build && npx next start
#   -> every route 200, shell intact, SapUnavailable rendered. No 500s.
CC_DEMO_SAP_LATENCY_MS=800 npx next dev
#   -> every navigation paints a skeleton within ~100ms; URL flips immediately.

# Phase B additions
#   -> /catalogue?page=2 reachable and shareable; changing a filter resets to page 1
#   -> catalogue RSC payload no longer grows with catalogue size
```

---

## 10. Next 16 API notes

This project runs **Next 16.3.1**, which renamed several App Router APIs. Code copied from
Next 15 tutorials will compile and then misbehave. Confirmed against
`node_modules/next/dist/docs/`:

| Concern | Next 15 | **Next 16.3.1** |
| --- | --- | --- |
| Error boundary recovery prop | `reset` | **`retry`** — `reset` still exists but only clears state *without* re-fetching; the docs say "in most cases, you should use `retry()`" |
| Middleware file | `middleware.ts` / `export function middleware` | **`proxy.ts`** / `export function proxy` — already done in this repo |
| Error message in production | — | Server Component messages are **stripped** to a generic string; only `error.digest` correlates to logs. Never branch on `error.message`. |
| `global-error.tsx` | — | Replaces the document; receives **no global styles**, so an app theme class or `data-theme` never reaches it. Style it inline. |
| Error boundary scope | — | `error.tsx` does **not** wrap the layout in its own segment. Root-layout failures need `global-error.tsx`. |
| Error boundary vs. SSR | — | **Measured:** `error.tsx` catches client-side navigation failures but **not** a throw during the initial document render — that still returns a 500 document. Handle expected server read failures in the page (§1 Layer 1). |

### Verified error-taxonomy facts

Confirmed by reading the source and by the logged output of the forced-outage run — useful
because the guard in §1 depends on all three:

- `SapError.retryable` is a non-optional `boolean`, defaulting to `kind === "unavailable"`.
- **Services do not let `SapError` escape.** Each catches at its boundary and re-throws its
  own class, so `isSapError(error)` is `false` at the page. Observed in the server log:
  `Error [OrderError]` and `Error [ReportingError]`, not `SapError`.
- Every one of those carries the same contract, which is what `safeRead` matches on:
  ```
  { status: 502, code: 'upstream_unavailable', digest: '2915347482' }
  ```

Per `AGENTS.md`, read the relevant guide under `node_modules/next/dist/docs/` before writing
any of the above — the bundled docs are the authority, not training data.
