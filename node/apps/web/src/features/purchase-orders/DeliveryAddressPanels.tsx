import { useMemo } from "react";
import clsx from "clsx";
import { MapPin, Users } from "lucide-react";
import type { PurchaseOrderDeliveryAddressInput } from "@accountmanagement/contracts";
import { deliveryAllocation } from "@accountmanagement/domain";
import { Alert, TextField } from "../../components/ui";
import { formatQuantity } from "../../lib/format";

/**
 * The two address panels from `08-create-purchase-order.md`: "Shipping
 * Addresses", listing the site's own addresses, and "Group Address", listing the
 * addresses of the chosen site group.
 *
 * ONE VALUE, TWO PANELS. Both write into the same
 * `deliveryAddresses` array, tagged by `kind`, because that is what they are in
 * the source too — one list, one table. What the source does not have is the
 * tag: it prefixes group addresses with the string "Group-" and strips it again
 * on the way out with `Replace`, so an address that happens to contain those
 * characters comes back mangled.
 *
 * A row exists in the array only while it is ticked. Unticking removes it rather
 * than keeping it with a zero, so "not going there" and "going there with
 * nothing" do not become the same stored row.
 */

type Row = PurchaseOrderDeliveryAddressInput;

export function DeliveryAddressPanels({
  siteAddresses,
  groupAddresses,
  groupChosen,
  value,
  onChange,
  orderedQuantity,
  loading,
  errors,
}: {
  siteAddresses: readonly string[];
  groupAddresses: readonly string[];
  /** False when no group is picked yet — the group panel says so. */
  groupChosen: boolean;
  value: readonly Row[];
  onChange: (next: Row[]) => void;
  /** The grid's quantity footer. What the allocation is measured against. */
  orderedQuantity: string;
  loading?: boolean;
  /** Per-row messages from the contract, keyed by the row's index in `value`. */
  errors?: Record<number, string | undefined>;
}) {
  const allocation = useMemo(
    () => deliveryAllocation.allocate(value, orderedQuantity),
    [value, orderedQuantity],
  );
  const allocationError = deliveryAllocation.allocationError(allocation);

  const indexOf = (kind: Row["kind"], address: string) =>
    value.findIndex((row) => row.kind === kind && row.address === address);

  const toggle = (kind: Row["kind"], address: string) => {
    const at = indexOf(kind, address);
    onChange(
      at === -1
        ? [...value, { kind, address, quantity: "" }]
        : value.filter((_row, index) => index !== at),
    );
  };

  const setQuantity = (kind: Row["kind"], address: string, quantity: string) => {
    const at = indexOf(kind, address);
    if (at === -1) {
      // Typing a quantity into an unticked row ticks it. Anything else means a
      // number sitting in a box that will not be saved.
      onChange([...value, { kind, address, quantity }]);
      return;
    }
    onChange(value.map((row, index) => (index === at ? { ...row, quantity } : row)));
  };

  const panel = (kind: Row["kind"], addresses: readonly string[]) =>
    addresses.map((address) => {
      const at = indexOf(kind, address);
      return {
        address,
        checked: at !== -1,
        quantity: at === -1 ? "" : value[at]!.quantity,
        error: at === -1 ? undefined : errors?.[at],
      };
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Shipping addresses"
          icon={MapPin}
          kind="site"
          rows={panel("site", siteAddresses)}
          total={allocation.byKind.site}
          onToggle={toggle}
          onQuantity={setQuantity}
          empty={
            loading
              ? "Loading addresses…"
              : "This site has no address recorded, so there is nothing to ship to. Add one on the Sites screen."
          }
        />

        <Panel
          title="Group address"
          icon={Users}
          kind="group"
          rows={panel("group", groupAddresses)}
          total={allocation.byKind.group}
          onToggle={toggle}
          onQuantity={setQuantity}
          empty={
            !groupChosen
              ? "Choose a group above to see its addresses."
              : loading
                ? "Loading addresses…"
                : "This group has no addresses."
          }
        />
      </div>

      {/*
        The running total, always visible.

        The legacy screen only tells you the quantities are wrong when you press
        Save, and then only through a toast that names one panel. Showing what is
        allocated against what is ordered is the same rule stated before it is
        broken rather than after.
      */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-xs ring-1 ring-inset ring-slate-200">
        <Figure label="Ordered" value={allocation.ordered} />
        <Figure label="Allocated" value={allocation.allocated} />
        {/* `remaining` is negative exactly when the allocation is over, so the
            sign is the label and does not also need to be shown. */}
        <Figure
          label={allocation.exceedsOrder ? "Over by" : "Unallocated"}
          value={allocation.remaining.replace("-", "")}
          tone={allocation.exceedsOrder ? "danger" : undefined}
        />
      </div>

      {allocationError && <Alert tone="danger">{allocationError}</Alert>}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-slate-500">{label}</span>
      <span
        className={clsx(
          "tabular font-medium",
          tone === "danger" ? "text-rose-600" : "text-slate-900",
        )}
      >
        {formatQuantity(value)}
      </span>
    </span>
  );
}

function Panel({
  title,
  icon: Icon,
  kind,
  rows,
  total,
  onToggle,
  onQuantity,
  empty,
}: {
  title: string;
  icon: typeof MapPin;
  kind: Row["kind"];
  rows: { address: string; checked: boolean; quantity: string; error?: string }[];
  total: string;
  onToggle: (kind: Row["kind"], address: string) => void;
  onQuantity: (kind: Row["kind"], address: string, quantity: string) => void;
  empty: string;
}) {
  return (
    <section className="rounded-md ring-1 ring-inset ring-slate-200">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
        <h4 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
          <Icon aria-hidden className="size-3.5" />
          {title}
        </h4>
        <span className="tabular text-[11px] text-slate-500">{formatQuantity(total)}</span>
      </header>

      {rows.length === 0 ? (
        <p className="px-2.5 py-3 text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.address} className="flex items-start gap-2.5 px-2.5 py-1.5">
              <input
                type="checkbox"
                checked={row.checked}
                onChange={() => onToggle(kind, row.address)}
                // The address IS the label. A separate visible label would
                // repeat it, and an aria-label is what a screen reader needs.
                aria-label={`Deliver to ${row.address}`}
                className="mt-1.5 size-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-0"
              />
              <span className="mt-1 min-w-0 flex-1 break-words text-xs text-slate-700">
                {row.address}
              </span>
              <div className="w-24 shrink-0">
                <TextField
                  label={`Quantity for ${row.address}`}
                  labelHidden
                  inputMode="decimal"
                  placeholder="Qty"
                  value={row.quantity}
                  error={row.error}
                  onChange={(event) => onQuantity(kind, row.address, event.target.value)}
                  className="text-right"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
