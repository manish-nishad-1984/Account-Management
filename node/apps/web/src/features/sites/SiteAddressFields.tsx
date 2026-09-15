import clsx from "clsx";
import type { AddressChoice } from "@accountmanagement/contracts";
import { SelectField } from "../../components/ui";
import { useSiteDocumentOptions } from "./api";

/**
 * Billing, shipping and location, for an order or invoice raised at a site.
 *
 * THE RULES THE BUSINESS SET ON 15 Sep 2026:
 *
 *  - BILLING is our own site's address and nothing else. It is SHOWN, not
 *    typed — the server copies the site's address onto the document when it is
 *    saved, whatever the browser sends, so a box here would be a box that
 *    silently does nothing.
 *  - SHIPPING is exactly ONE address, chosen from everything recorded for the
 *    site: its own address, the delivery addresses on the Site master, and the
 *    addresses on the Site Location screen. It is copied onto the document as
 *    text, so correcting the site later cannot rewrite where a delivery went.
 *  - LOCATION, where the document has one, is one of the site's location names.
 *
 * WHEN THE PERSON CHANGES THE SITE, the form must clear the shipping choice and
 * the location, because both belonged to the site chosen before. That is done by
 * the Site select's own `onChange` in each form, NOT by watching `siteId` here:
 * in the side-panel layout, clicking another row loads a different document into
 * the same mounted form, and a watcher cannot tell that from a person changing
 * the site — it would wipe the location off every document opened that way.
 */
export function SiteAddressFields({
  siteId,
  shippingAddress,
  onShippingChange,
  shippingError,
  location,
}: {
  siteId: string | null | undefined;
  shippingAddress: string | null | undefined;
  onShippingChange: (address: string) => void;
  shippingError?: string;
  /** Present on documents that carry a location: purchase orders and purchase invoices. */
  location?: {
    /** `unknown` because an optional-uuid field's form input type is `unknown`. */
    value: unknown;
    onChange: (locationId: string) => void;
    error?: string;
  };
}) {
  const chosenSite = siteId && siteId !== "" ? siteId : null;
  const options = useSiteDocumentOptions(chosenSite);

  const choices = options.data?.shippingAddresses ?? [];
  const current = (shippingAddress ?? "").trim();
  /**
   * A document raised before this rule may carry an address that is not on the
   * site's list any more — typed by hand, or since removed from the site. It is
   * shown as what it is rather than dropped, and stays chosen until someone
   * picks another.
   */
  const savedElsewhere = current !== "" && !choices.some((choice) => choice.address === current);

  const locationOptions = [
    { value: "", label: "No location" },
    ...(options.data?.locations ?? []).map((row) => ({ value: row.id, label: row.name })),
  ];

  return (
    <div className="space-y-3">
      {location && (
        <div className="sm:max-w-xs">
          <SelectField
            label="Location"
            options={locationOptions}
            disabled={!chosenSite}
            hint={
              !chosenSite
                ? "Choose a site first"
                : options.isLoading
                  ? "Loading locations…"
                  : locationOptions.length === 1
                    ? "This site has no locations. Add them on Site Location."
                    : undefined
            }
            error={location.error}
            value={typeof location.value === "string" ? location.value : ""}
            onChange={(event) => location.onChange(event.target.value)}
          />
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-slate-600">Billing address</div>
        <div
          className={clsx(
            "mt-1 whitespace-pre-line rounded-lg bg-slate-50 px-2.5 py-2 text-sm ring-1 ring-inset ring-slate-200",
            options.data?.billingAddress ? "text-slate-800" : "text-slate-500",
          )}
          aria-label="Billing address"
        >
          {!chosenSite
            ? "Choose a site first"
            : options.isLoading
              ? "Loading…"
              : (options.data?.billingAddress ??
                "This site has no address. Add one on the Sites screen.")}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Always the site's own address, set when this is saved.
        </p>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Shipping address</legend>
        {!chosenSite ? (
          <p className="mt-1 text-sm text-slate-500">Choose a site first.</p>
        ) : options.isLoading ? (
          <p className="mt-1 text-sm text-slate-500">Loading addresses…</p>
        ) : choices.length === 0 && !savedElsewhere ? (
          <p className="mt-1 text-sm text-slate-500">
            This site has no addresses yet. Add them on the Sites or Site Location screen.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Shipping address"
            className="scroll-subtle mt-1 max-h-56 overflow-y-auto rounded-lg ring-1 ring-inset ring-slate-200"
          >
            {savedElsewhere && (
              <ShippingOption
                label="Saved on this document"
                address={current}
                checked
                onChoose={() => onShippingChange(current)}
              />
            )}
            {choices.map((choice) => (
              <ShippingOption
                key={choice.key}
                label={SOURCE_LABEL[choice.source]}
                address={choice.address}
                checked={choice.address === current}
                onChoose={() => onShippingChange(choice.address)}
              />
            ))}
          </div>
        )}
        {shippingError && (
          <p className="mt-1 text-[11px] leading-4 text-rose-600" role="alert">
            {shippingError}
          </p>
        )}
      </fieldset>
    </div>
  );
}

const SOURCE_LABEL: Record<AddressChoice["source"], string> = {
  site: "Site address",
  "site-shipping": "Site shipping address",
  extra: "Site delivery address",
  location: "Location address",
};

function ShippingOption({
  label,
  address,
  checked,
  onChoose,
}: {
  label: string;
  address: string;
  checked: boolean;
  onChoose: () => void;
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-2.5 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 hover:bg-slate-50",
        checked && "bg-brand-50/60",
      )}
    >
      <input
        type="radio"
        name="shipping-address"
        checked={checked}
        onChange={onChoose}
        className="mt-0.5 size-3.5 shrink-0 border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0">
        <span className="block whitespace-pre-line text-slate-800">{address}</span>
        <span className="block text-[11px] text-slate-500">{label}</span>
      </span>
    </label>
  );
}
