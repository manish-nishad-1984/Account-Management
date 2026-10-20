import { formatMoney } from "../../lib/format";
import { fromPaise, toPaise } from "./decimal";

/** Whether a bill is part paid: something is still pending, and less than the bill. */
export function isPartPaid(billAmount: string | null | undefined, pending: string): boolean {
  const total = billAmount ? toPaise(billAmount) : null;
  const left = toPaise(pending);
  return total !== null && left !== null && left > 0n && left < total;
}

/**
 * "Part paid" beside a bill on the payout builder (client, 19 Oct 2026): the bill
 * shows only what is pending, so a bill paid in part looked like a small bill. The
 * badge says it, and what of the bill has been paid.
 */
export function PartPaid({ billAmount, pending }: { billAmount: string | null | undefined; pending: string }) {
  if (!isPartPaid(billAmount, pending)) return null;
  const paid = fromPaise(toPaise(billAmount!)! - toPaise(pending)!);
  return (
    <>
      <span className="ml-2 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 ring-1 ring-inset ring-violet-200">
        Part paid
      </span>
      <span className="ml-1.5 text-xs text-slate-500">
        {formatMoney(paid)} paid of {formatMoney(billAmount!)}
      </span>
    </>
  );
}
