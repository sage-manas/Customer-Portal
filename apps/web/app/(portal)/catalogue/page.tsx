import { hasPermission } from "@cc/domain";
import { browseCatalogue } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { PageHeader, SapSyncIndicator, StaleDataBanner } from "@cc/ui";
import { redirect } from "next/navigation";

import { CatalogueFilters } from "./CatalogueFilters";
import { ProductGrid } from "./ProductGrid";

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

const PAGE_SIZE = 24;

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

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await browseCatalogue(sap, {
    search: single("q"),
    materialGroup: single("group"),
    plant: single("plant"),
    limit: PAGE_SIZE,
  });

  // The filter options are the groups/plants the catalogue actually
  // contains, read from an unfiltered pass — a filter offering a value that
  // returns nothing is worse than no filter.
  const unfiltered = await browseCatalogue(sap);
  const groups = [...new Set(unfiltered.page.items.map((m) => m.materialGroup))].sort();

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Catalogue"
        subtitle="Your catalogue, at your contracted prices."
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
      />

      <CatalogueFilters
        groups={groups}
        search={single("q")}
        group={single("group")}
        plant={single("plant")}
        total={result.page.total}
      />

      <ProductGrid
        materials={result.page.items}
        plant={single("plant")}
        canAddToCart={hasPermission(session, "cart:manage") && Boolean(session.kunnr)}
        hasAccount={Boolean(session.kunnr)}
      />
    </>
  );
}
