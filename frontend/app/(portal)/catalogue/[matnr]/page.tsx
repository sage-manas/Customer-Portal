import { hasPermission, stockAvailability } from "@cc/domain";
import { getProductDetail, isCatalogueError } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  Money,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  StockChip,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AddToCartPanel } from "./AddToCartPanel";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Product detail (docs/05 §7.2): gallery + spec sheet, price breaks, MOQ
 * enforcement on the stepper, plant-wise stock table, and "Request quote"
 * for large quantities.
 *
 * An unknown material is a 404 — including one that exists in another
 * tenant's landscape, since the adapter is resolved per tenant and simply
 * doesn't find it (CLAUDE.md rule 5).
 */

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ matnr: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { matnr } = await params;
  const material = decodeURIComponent(matnr);

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title={material} />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so we can&apos;t show your prices. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() =>
    getProductDetail(sap, session.kunnr, material).catch((error: unknown) => {
      if (isCatalogueError(error) && error.code === "not_found") notFound();
      throw error;
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title={material} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const detail = result.data;
  const record = detail.material;

  return (
    <>
      {detail.freshness === "stale" ? <StaleDataBanner syncedAt={detail.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/catalogue" className="hover:text-primary">
          Catalogue
        </Link>
        <span aria-hidden> / </span>
        <span className="font-mono text-text-mid">{record.material}</span>
      </nav>

      <PageHeader
        title={record.description}
        subtitle={
          <span className="font-mono">
            {record.material} · {record.materialGroup} · {record.uom}
          </span>
        }
        meta={<SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-[13px] font-bold text-text">Your price</h2>
            {detail.price ? (
              <>
                <p className="mt-2 flex items-baseline gap-2">
                  <Money value={detail.price.netPrice} className="text-xl font-bold" />
                  <span className="text-[11.5px] text-text-dim">per {record.uom}, ex-GST</span>
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-4">
                  <Field label="List price (PR00)">
                    <Money value={detail.price.listPrice} />
                  </Field>
                  <Field label="Your discount">{detail.price.discountPercent}%</Field>
                  <Field label="Condition record">
                    <span className="font-mono">{detail.price.conditionRecord ?? "—"}</span>
                  </Field>
                  <Field label="Valid">
                    {detail.price.validFrom ? formatDisplayDate(detail.price.validFrom) : "—"}
                    {" – "}
                    {detail.price.validTo ? formatDisplayDate(detail.price.validTo) : "—"}
                  </Field>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-[12.5px] text-text-dim">
                {detail.priceUnavailableReason ??
                  "No price is published for this item — request a quote and sales will price it."}
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
            <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text">
              Stock by plant
            </h2>
            {detail.stock.length === 0 ? (
              <p className="px-4 py-6 text-[12.5px] text-text-dim">
                This item is not stocked — it is made to order.
              </p>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                    <th scope="col" className="px-4 py-2 font-bold">
                      Plant
                    </th>
                    <th scope="col" className="px-4 py-2 font-bold">
                      Available
                    </th>
                    <th scope="col" className="px-4 py-2 font-bold">
                      Lead time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.stock.map((level) => (
                    <tr key={level.plant} className="border-t border-border">
                      <td className="px-4 py-2.5 font-mono text-text-mid">{level.plant}</td>
                      <td className="px-4 py-2.5">
                        <StockChip
                          // Classified by the domain helper, never inline:
                          // one definition of "low" for every screen.
                          availability={stockAvailability(level.quantity, record.minimumOrderQty)}
                          quantity={level.quantity}
                          uom={level.uom}
                          leadTimeDays={level.leadTimeDays}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {level.leadTimeDays ? `${level.leadTimeDays} days` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <AddToCartPanel
          material={record.material}
          uom={record.uom}
          minimumOrderQty={record.minimumOrderQty}
          availability={detail.availability}
          totalQuantity={detail.totalQuantity}
          priced={detail.price !== null}
          canAddToCart={hasPermission(session, "cart:manage")}
          specSheetUrl={record.specSheetUrl}
        />
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wide text-text-dim">{label}</dt>
      <dd className="mt-0.5 text-text">{children}</dd>
    </div>
  );
}
