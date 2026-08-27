import { hasPermission } from "@cc/domain";
import { browseCatalogue, listMaterialGroups } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, Pager, SapSyncIndicator, SapUnavailable, StaleDataBanner } from "@cc/ui";
import { redirect } from "next/navigation";

import { CatalogueFilters } from "./CatalogueFilters";
import { ProductGrid } from "./ProductGrid";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Browse Catalogue (docs/03 Screen 2.1, docs/05 §7.2): filter rail (search
 * MATNR/MAKTX, category MATKL, plant WERKS) + card grid.
 *
 * The material list is read on the server; price and stock are *not* —
 * they are per-customer SAP calls that doc 05 requires to load lazily per
 * card, so `ProductGrid` fetches them one card at a time.
 */

export const dynamic = "force-dynamic";

// Capped regardless of the env override: ProductGrid now bats a page's
// worth of availability reads into one request (REMEDIATION-PLAN §6), but a
// single request over hundreds of materials is still a single slow request.
const PAGE_SIZE = Math.min(Number(process.env.CC_CATALOGUE_PAGE_SIZE ?? 24) || 24, 48);

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) || undefined;
  };

  const offset = Math.max(0, Number(single("page") ?? 1) - 1) * PAGE_SIZE;

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() =>
    browseCatalogue(sap, {
      search: single("q"),
      materialGroup: single("group"),
      plant: single("plant"),
      limit: PAGE_SIZE,
      offset,
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

  // The filter options are the groups the catalogue actually contains — a
  // filter offering a value that returns nothing is worse than no filter.
  // This is a dedicated read, not the full unfiltered item dump the match-code
  // search used to piggyback on (REMEDIATION-PLAN §5): that grew with the
  // catalogue and shipped on every render regardless of what was typed.
  const groupsRead = await safeRead(() => listMaterialGroups(sap));
  const groups = groupsRead.ok ? groupsRead.data : [];

  return (
    <>
      {result.data.freshness === "stale" ? (
        <StaleDataBanner syncedAt={result.data.syncedAt} />
      ) : null}

      <PageHeader
        title="Catalogue"
        subtitle="Your catalogue, at your contracted prices."
        meta={<SapSyncIndicator state={result.data.freshness} syncedAt={result.data.syncedAt} />}
      />

      <CatalogueFilters
        groups={groups}
        search={single("q")}
        group={single("group")}
        plant={single("plant")}
        total={result.data.page.total}
      />

      <ProductGrid
        // Remounts on any filter/page change so its batched availability
        // fetch (REMEDIATION-PLAN §6) always starts from a clean loading
        // state instead of needing to reset one mid-effect.
        key={`${single("q") ?? ""}:${single("group") ?? ""}:${single("plant") ?? ""}:${offset}`}
        materials={result.data.page.items}
        plant={single("plant")}
        canAddToCart={hasPermission(session, "cart:manage") && Boolean(session.kunnr)}
        hasAccount={Boolean(session.kunnr)}
      />

      <Pager
        total={result.data.page.total}
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
    </>
  );
}
