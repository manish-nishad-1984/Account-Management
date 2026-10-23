import type { PayoutListDetail } from "@accountmanagement/contracts";
import { formatMoney } from "../../lib/format";
import { sumAmounts } from "./decimal";

/**
 * The WhatsApp text of a payout list: date, optional title, one line per party,
 * and the TOTAL LAST (the owner reads down the names and stops at the figure).
 *
 * "Rs", not the rupee sign. WhatsApp renders ₹ from the sender's font, and a
 * list forwarded to a phone whose font lacks it arrives as a box; "Rs" always
 * arrives. Whichever is chosen must be the same on every line, and this is the
 * one place it is chosen.
 *
 * THE TOTAL IS ADDED UP FROM THE LINES SHOWN, not copied from `detail.total`:
 * the message must add up on its face even if the two were ever to disagree.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `05 Oct 2026` from `2026-10-05`, read off the string. `new Date("2026-10-05")`
 * is midnight UTC and renders as the 4th west of Greenwich - the same off-by-one
 * the export formatter documents.
 */
export function formatListDate(listDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(listDate);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${match[3]} ${month} ${match[1]}` : listDate;
}

export const rupees = (amount: string): string => `Rs ${formatMoney(amount)}`;

/** `2026-10` as people say it: `Oct 2026`. */
export const monthLabel = (month: string): string => {
  const [year, number] = month.split("-");
  const name = MONTHS[Number(number) - 1];
  return name && year ? `${name} ${year}` : month;
};

/** A salary as one line of a list: the employee and the month (client, 23 Oct 2026). */
export const salaryLabel = (salary: { employeeName: string; month: string }): string =>
  `${salary.employeeName} (Salary ${monthLabel(salary.month)})`;

type Salaries = { salaries?: PayoutListDetail["salaries"] };

/** Parties then salaries, as they are counted in a total: "2 parties, 1 salary". */
export const countLabel = (parties: number, salaries: number): string =>
  [
    `${parties} ${parties === 1 ? "party" : "parties"}`,
    salaries > 0 ? `${salaries} ${salaries === 1 ? "salary" : "salaries"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

/** Every amount on the list, parties and salaries. */
export const listAmounts = (detail: Pick<PayoutListDetail, "lines"> & Salaries): string[] => [
  ...detail.lines.map((line) => line.amount),
  ...(detail.salaries ?? []).map((one) => one.amount),
];

export function buildPayoutMessage(
  detail: Pick<PayoutListDetail, "listDate" | "title" | "lines"> & Salaries,
): string {
  const lines = [`Payout list - ${formatListDate(detail.listDate)}`];
  const title = detail.title?.trim();
  if (title) lines.push(title);

  detail.lines.forEach((line, index) => {
    lines.push(`${index + 1}. ${line.partyName} - ${rupees(line.amount)}`);
    // The bills under a party, when the list was built from bills.
    for (const bill of line.invoices ?? []) {
      const date = bill.documentDate ? ` (${formatListDate(bill.documentDate)})` : "";
      lines.push(`    ${bill.displayNo}${date} - ${rupees(bill.amount)}`);
    }
  });

  const salaries = detail.salaries ?? [];
  salaries.forEach((one, index) => {
    lines.push(`${detail.lines.length + index + 1}. ${salaryLabel(one)} - ${rupees(one.amount)}`);
  });

  lines.push(`Total: ${rupees(sumAmounts(listAmounts(detail)))}`);
  return lines.join("\n");
}

/**
 * Deliberately NO phone number: the client sends the list to the owner or to
 * their own number and forwards it, so WhatsApp has to ask who. `wa.me/?text=`
 * does exactly that.
 */
export const whatsAppUrl = (message: string): string =>
  `https://wa.me/?text=${encodeURIComponent(message)}`;
