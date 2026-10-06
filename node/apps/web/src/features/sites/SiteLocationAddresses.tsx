import clsx from "clsx";
import { SelectField } from "../../components/ui";
import { LABEL_BASE } from "../../components/ui/fields";
import { useSiteDocumentOptions } from "./api";

/**
 * Location, billing and shipping on one compact row (client request, 6 Oct 2026,
 * purchase invoices): the Location is chosen, and both addresses are SHOWN.
 *
 *  - BILLING is the site's own address and is never typed (the server copies it
 *    on save).
 *  - SHIPPING is the chosen location's address, and nothing else. A location
 *    that has no address leaves it BLANK, and so does no location: there is no
 *    picker to fall back on. Choosing the location is what sets it, so the person
 *    cannot choose an address that disagrees with the location beside it.
 *
 * Shipping is set from the select's own `onChange`, never by watching: in the
 * side-panel layout a different saved document is loaded into this mounted form,
 * and a watcher would overwrite the address that document was saved with.
 */
export function SiteLocationAddresses({
  siteId,
  shippingAddress,
  onShippingChange,
  location,
  className,
}: {
  siteId: string | null | undefined;
  shippingAddress: string | null | undefined;
  onShippingChange: (address: string) => void;
  location: {
    /** `unknown` because an optional-uuid field's form input type is `unknown`. */
    value: unknown;
    onChange: (locationId: string) => void;
    error?: string;
  };
  className?: string;
}) {
  const chosenSite = siteId && siteId !== "" ? siteId : null;
  const options = useSiteDocumentOptions(chosenSite);

  const locations = [
    { value: "", label: "No location" },
    ...(options.data?.locations ?? []).map((row) => ({ value: row.id, label: row.name })),
  ];
  const selected = typeof location.value === "string" ? location.value : "";
  const addressOf = (locationId: string): string =>
    (options.data?.shippingAddresses ?? []).find((choice) => choice.key === `location-${locationId}`)?.address ?? "";

  const billing = !chosenSite
    ? ""
    : options.isLoading
      ? "Loading…"
      : (options.data?.billingAddress ?? "");

  return (
    <div className={clsx("grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]", className)}>
      <SelectField
        label="Location"
        options={locations}
        disabled={!chosenSite}
        error={location.error}
        value={selected}
        onChange={(event) => {
          const locationId = event.target.value;
          location.onChange(locationId);
          // No location, or one with no address, leaves shipping blank.
          onShippingChange(locationId === "" ? "" : addressOf(locationId));
        }}
      />
      <ReadOnlyAddress label="Billing address" value={billing} />
      <ReadOnlyAddress label="Shipping address" value={(shippingAddress ?? "").trim()} />
    </div>
  );
}

/** A value shown as text in a box that looks like a field and cannot be typed into. */
function ReadOnlyAddress({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={LABEL_BASE}>{label}</div>
      <div
        aria-label={label}
        className="mt-1 min-h-9 whitespace-pre-line rounded-lg bg-slate-50 px-2.5 py-2 text-sm leading-5 text-slate-800 ring-1 ring-inset ring-slate-200"
      >
        {value}
      </div>
    </div>
  );
}
