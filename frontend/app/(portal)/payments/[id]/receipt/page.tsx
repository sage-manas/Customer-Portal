import { hasPermission, paymentModeLabel } from "@cc/domain";
import { getPayment, isPaymentError } from "@cc/service-payment";
import { Money, PageHeader, SapUnavailable, formatDisplayDate } from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CheckoutPanel } from "./CheckoutPanel";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Payment receipt and return states (docs/05 §7.7): "**Success** (receipt
 * page: gateway ref KIDNO, posted note 'Payment recorded, clearing in SAP',
 * printable) / **Pending** (polling banner) / **Failed** (retry, no
 * double-charge copy)."
 *
 * All three are the same page, because from the customer's side they are the
 * same thing at different moments: one payment, whose state is whatever the
 * gateway and SAP have told us so far. The page never advances it — only a
 * signed webhook does — so a customer refreshing here is asking a question,
 * not taking an action.
 */

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const result = await safeRead(() =>
    getPayment(session.tenantId, session.kunnr, id).catch((error: unknown) => {
      // Another account's payment and one that never existed answer the same.
      if (isPaymentError(error) && error.code === "not_found") notFound();
      throw error;
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title={`Payment ${id}`} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const payment = result.data;
  const canPay = hasPermission(session, "payment:pay");

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim print:hidden">
        <Link href="/payments" className="hover:text-primary">
          Payments
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">Receipt</span>
      </nav>

      <PageHeader
        title={payment.status === "posted" ? "Payment received" : "Your payment"}
        subtitle={`Started ${formatDisplayDate(payment.createdAt.toISOString())} · ${paymentModeLabel(payment.mode)}`}
      />

      <StateBanner
        status={payment.status}
        failureReason={payment.failureReason}
        fiDocumentNumber={payment.fiDocumentNumber}
      />

      {/* The checkout hand-off, and the polling the Pending state needs. */}
      <CheckoutPanel
        paymentId={payment.id}
        status={payment.status}
        canPay={canPay}
        gatewayReference={payment.gatewayReference}
      />

      <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-[15px] font-bold text-text">Details</h2>

        <dl className="mt-3 grid gap-x-8 gap-y-2 text-[12.5px] sm:grid-cols-2">
          <Detail label="Amount">
            <Money value={payment.amount} className="text-[14px] font-bold" />
          </Detail>
          <Detail label="Method">{paymentModeLabel(payment.mode)}</Detail>
          <Detail label="Payment reference">
            <span className="font-mono text-[12px]">{payment.gatewayReference ?? "—"}</span>
          </Detail>
          <Detail label="Accounting document">
            <span className="font-mono text-[12px]">{payment.fiDocumentNumber ?? "—"}</span>
          </Detail>
        </dl>
      </section>

      <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <h2 className="border-b border-border px-4 py-3 text-[15px] font-bold text-text">
          Applied to
        </h2>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Invoice
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Amount
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Outcome
              </th>
            </tr>
          </thead>
          <tbody>
            {payment.allocations.map((allocation) => {
              const cleared = payment.clearedItems.includes(allocation.documentNumber);
              return (
                <tr key={allocation.documentNumber} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/invoices/${allocation.documentNumber}`}
                      className="font-mono text-[12px] text-primary underline-offset-2 hover:underline"
                    >
                      {allocation.documentNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={allocation.amount} />
                  </td>
                  <td className="px-4 py-2.5 text-text-mid">
                    {payment.status !== "posted"
                      ? "—"
                      : cleared
                        ? "Settled in full"
                        : "Part-paid — the balance stays open"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="text-[11.5px] text-text-dim print:hidden">
        Keep this page for your records — your accounts team can reconcile against the payment
        reference above.
      </p>
    </>
  );
}

/** The three return states doc 05 §7.7 specifies, in the customer's words. */
function StateBanner({
  status,
  failureReason,
  fiDocumentNumber,
}: {
  status: string;
  failureReason?: string;
  fiDocumentNumber?: string;
}) {
  if (status === "posted") {
    return (
      <section
        role="status"
        className="rounded-md border border-success-border bg-success-subtle p-4 shadow-sm"
      >
        <h2 className="text-[13.5px] font-bold text-success">Payment recorded</h2>
        <p className="mt-1 max-w-2xl text-[12.5px] text-success">
          Your payment has been received and posted against your invoices
          {fiDocumentNumber ? ` as accounting document ${fiDocumentNumber}` : ""}. Your statement is
          already up to date.
        </p>
      </section>
    );
  }

  if (status === "captured") {
    return (
      <section
        role="status"
        className="rounded-md border border-warning-border bg-warning-subtle p-4 shadow-sm"
      >
        <h2 className="text-[13.5px] font-bold text-warning">
          Payment received — clearing in progress
        </h2>
        <p className="mt-1 max-w-2xl text-[12.5px] text-warning">
          We have your payment and it&apos;s being posted against your invoices. Nothing further is
          needed from you, and you have not been charged twice. Your statement will update shortly.
        </p>
      </section>
    );
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <section
        role="alert"
        className="rounded-md border border-danger-border bg-danger-subtle p-4 shadow-sm"
      >
        <h2 className="text-[13.5px] font-bold text-danger">Payment didn&apos;t go through</h2>
        <p className="mt-1 max-w-2xl text-[12.5px] text-danger">
          {failureReason
            ? "Your bank didn't complete this payment."
            : "This payment wasn't completed."}{" "}
          <strong>You have not been charged</strong> — nothing left your account, and your invoices
          are unchanged. You can safely try again.
        </p>
        <Link
          href="/payments/pay"
          className="mt-2 inline-block text-[12px] font-semibold text-danger underline underline-offset-2"
        >
          Try again
        </Link>
      </section>
    );
  }

  return (
    <section role="status" className="rounded-md border border-border bg-surface p-4 shadow-sm">
      <h2 className="text-[13.5px] font-bold text-text">Waiting for your bank</h2>
      <p className="mt-1 max-w-2xl text-[12.5px] text-text-mid">
        This payment hasn&apos;t been confirmed yet. If you&apos;ve already approved it with your
        bank or UPI app, it will appear here within a few moments — don&apos;t pay again.
      </p>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">{label}</dt>
      <dd className="mt-0.5 text-text">{children}</dd>
    </div>
  );
}
