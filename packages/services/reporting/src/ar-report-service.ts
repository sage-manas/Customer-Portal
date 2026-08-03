import type { CacheStore } from "@cc/adapter-cache";
import { earliestSyncedAt, isSapError, leastFresh, type SapAdapter } from "@cc/adapter-sap";
import type { AgingBucketKey, AgingSummary, OpenItem } from "@cc/domain";
import {
  agingBucketFor,
  AGING_BUCKETS,
  buildAging,
  daysOverdue,
  REPORT_CACHE_TTL_SECONDS,
} from "@cc/domain";

import { cacheAside, getReportCache, type Cached } from "./cache";
import { ReportingError } from "./errors";
import type { ReportingContext } from "./sales-report-service";

/**
 * AR summary (docs/05 §7.10: "`AmountAging` buckets + drill-down table per
 * bucket → invoice links").
 *
 * The aging itself is `buildAging` in `@cc/domain` — the same function the
 * account statement and the invoice list already use, so the AR *report* and
 * the AR *screen* cannot disagree about which bucket a document is in
 * (ADR-018). This file adds only the drill-down: which documents make up a
 * bucket, which the aging summary deliberately does not carry.
 *
 * It reads BSID (`getOpenItems`), not the stored payment rows. That is
 * ADR-019's distinction and it is worth restating where a *report* is
 * involved, because a report is exactly where somebody would be tempted to
 * sum the portal's own payments: the stored rows answer "what did we take?",
 * never "what does the customer owe?".
 */

export interface AgingBucketRow {
  documentNumber: string;
  documentType: string;
  postingDate: string;
  dueDate: string;
  openAmount: number;
  currency: string;
  daysOverdue: number;
  /** True when the document is a billing document we can deep-link to. */
  isInvoice: boolean;
}

export interface ArSummary {
  aging: AgingSummary;
  /** Rows per bucket, oldest first — what the drill-down renders. */
  documents: Record<AgingBucketKey, AgingBucketRow[]>;
  today: string;
  currency: string;
}

export interface ArSummaryOptions {
  today?: string;
  refresh?: boolean;
  store?: CacheStore;
}

/** BKPF-BLART values that correspond to a billing document (docs/05 §7.7). */
const INVOICE_DOC_TYPES = new Set(["RV"]);

export async function getArSummary(
  adapter: SapAdapter,
  context: ReportingContext,
  options: ArSummaryOptions = {},
): Promise<Cached<ArSummary>> {
  if (!context.kunnr) throw new ReportingError("no_account");

  const today = (options.today ?? new Date().toISOString()).slice(0, 10);

  return cacheAside<ArSummary>({
    store: options.store ?? getReportCache(),
    tenantId: context.tenantId,
    namespace: "reports.ar",
    parts: [context.kunnr, today],
    ttlSeconds: REPORT_CACHE_TTL_SECONDS["reports.ar"],
    bypass: options.refresh,
    load: async () => {
      try {
        const openItems = await adapter.getOpenItems(context.kunnr);
        const items = openItems.data;

        return {
          data: {
            aging: buildAging(items, today),
            documents: groupByBucket(items, today),
            today,
            currency: items.find((item) => item.currency)?.currency ?? "INR",
          },
          freshness: leastFresh([openItems]),
          syncedAt: earliestSyncedAt([openItems]),
        };
      } catch (error) {
        if (isSapError(error) && error.kind === "unavailable") {
          throw new ReportingError("upstream_unavailable", undefined, { cause: error });
        }
        throw error;
      }
    },
  });
}

/**
 * Every bucket is a key in the result, including the empty ones. A
 * drill-down that omits a bucket makes the UI branch on presence, and the
 * empty bucket is a legitimate answer to click on.
 */
function groupByBucket(
  items: readonly OpenItem[],
  today: string,
): Record<AgingBucketKey, AgingBucketRow[]> {
  const grouped = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [bucket.key, [] as AgingBucketRow[]]),
  ) as Record<AgingBucketKey, AgingBucketRow[]>;

  for (const item of items) {
    // Same exclusion `buildAging` makes: a cleared document is not part of
    // the receivable, so the bucket totals and the rows under them agree.
    if (item.openAmount <= 0) continue;

    grouped[agingBucketFor(item.dueDate, today)].push({
      documentNumber: item.documentNumber,
      documentType: item.documentType,
      postingDate: item.postingDate,
      dueDate: item.dueDate,
      openAmount: item.openAmount,
      currency: item.currency,
      daysOverdue: daysOverdue(item.dueDate, today),
      isInvoice: INVOICE_DOC_TYPES.has(item.documentType),
    });
  }

  for (const rows of Object.values(grouped)) {
    rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }
  return grouped;
}
