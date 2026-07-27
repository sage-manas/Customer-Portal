import { getPriceList } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  Money,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

/**
 * Customer-Specific Price List (docs/03 Screen 2.2, docs/05 §7.2 "Price
 * List tab"): condition-record validity (KNUMH, DATAB–DATBI), discount %
 * (K007), and a downloadable copy.
 *
 * Every catalogue material appears, including those with no condition
 * record — marked "On request" rather than omitted, because a gap in a
 * price list reads as a discontinued product.
 */

export const dynamic = "force-dynamic";

export default async function PriceListPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Price list" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no contracted prices to
          show. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const list = await getPriceList(sap, session.kunnr);

  return (
    <>
      {list.freshness === "stale" ? <StaleDataBanner syncedAt={list.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/catalogue" className="hover:text-primary">
          Catalogue
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">Price list</span>
      </nav>

      <PageHeader
        title="Your price list"
        subtitle={`Contracted prices for account ${list.kunnr}, ex-GST.`}
        meta={<SapSyncIndicator state={list.freshness} syncedAt={list.syncedAt} />}
      />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Material
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Description
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                UoM
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                MOQ
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                List price
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Discount
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Your price
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Condition
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Valid
              </th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <tr key={row.material} className="border-t border-border">
                <td className="px-4 py-2.5">
                  <DocumentNumber
                    value={row.material}
                    href={`/catalogue/${encodeURIComponent(row.material)}`}
                  />
                </td>
                <td className="px-4 py-2.5 text-text-mid">{row.description}</td>
                <td className="px-4 py-2.5 text-text-dim">{row.uom}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-mid">
                  {row.minimumOrderQty}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {row.listPrice === null ? (
                    <span className="text-text-dim">—</span>
                  ) : (
                    <Money value={row.listPrice} />
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-text-mid">
                  {row.discountPercent === null ? "—" : `${row.discountPercent}%`}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {row.netPrice === null ? (
                    <span className="text-[11.5px] text-text-dim">On request</span>
                  ) : (
                    <Money value={row.netPrice} className="font-semibold" />
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-text-dim">
                  {row.conditionRecord ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-[11.5px] text-text-dim">
                  {row.validFrom && row.validTo
                    ? `${formatDisplayDate(row.validFrom)} – ${formatDisplayDate(row.validTo)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-text-dim">
        Prices are exclusive of GST and reflect the condition records valid today. PDF/XLSX download
        arrives with the reporting module.
      </p>
    </>
  );
}
