import clsx from "clsx";
import type { AddressChoice } from "@accountmanagement/contracts";
import { SelectField } from "../../components/ui";
// The density scale, so the shipping picker is the same 36px box as the Location
// select beside it. See the note on CONTROL_BASE.
import { CONTROL_BASE, LABEL_BASE, ringFor } from "../../components/ui/fields";
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
      {/*
        The location select is full width, like the billing box and the shipping
        picker under it. It was capped at 20rem when this panel was a narrow
        column; in the paired layout that cap left two thirds of the row empty
        above two full-width fields, which reads as a mistake rather than as
        restraint.
      */}
      {location && (
        <div>
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
        <p className="mt-1 text-xs leading-4 text-slate-500">
          Always the site's own address, set when this is saved.
        </p>
      </div>

      <div>
        <label htmlFor={SHIPPING_ID} className={LABEL_BASE}>
          Shipping address
        </label>
        {!chosenSite ? (
          <p className="mt-1 text-sm text-slate-500">Choose a site first.</p>
        ) : options.isLoading ? (
          <p className="mt-1 text-sm text-slate-500">Loading addresses…</p>
        ) : choices.length === 0 && !savedElsewhere ? (
          <p className="mt-1 text-sm text-slate-500">
            This site has no addresses yet. Add them on the Sites or Site Location screen.
          </p>
        ) : (
          <>
            {/*
              A PICKER, NOT A SCROLLING RADIO LIST (client request, 21 Sep 2026,
              from a mockup).

              Every address of a site was drawn as a radio row holding a wrapped
              two- or three-line address, so a site with four of them was a 224px
              scrolling panel inside a form that was already too tall — and the
              chosen one was usually out of sight inside it. Collapsed to one
              control with the choice shown underneath, it is four lines instead
              of fifteen and the answer is always visible.

              WHAT MUST NOT CHANGE, and has not: the value posted is still the
              address TEXT, one of them at a time, copied onto the document so
              that correcting the site later cannot rewrite where a delivery
              went. Every choice is still offered, and `<optgroup>` carries the
              source — site, site shipping, site delivery, location — which the
              radio rows carried as a caption.
            */}
            <select
              id={SHIPPING_ID}
              className={clsx(CONTROL_BASE, ringFor(shippingError), "mt-1 px-2.5 pr-8")}
              value={current}
              aria-invalid={shippingError ? true : undefined}
              aria-describedby={shippingError ? `${SHIPPING_ID}-error` : undefined}
              onChange={(event) => onShippingChange(event.target.value)}
            >
              {/*
                Disabled, so the picker cannot be used to go BACK to nothing —
                the radio list it replaces had no way to un-choose either, and
                changing that would be changing what the form can post.
              */}
              <option value="" disabled>
                Choose a shipping address
              </option>
              {savedElsewhere && (
                <optgroup label={SAVED_HERE}>
                  <option value={current}>{oneLine(current)}</option>
                </optgroup>
              )}
              {groupBySource(choices).map((group) => (
                <optgroup key={group.source} label={SOURCE_LABEL[group.source]}>
                  {group.choices.map((choice) => (
                    <option key={choice.key} value={choice.address}>
                      {oneLine(choice.address)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/*
              The chosen address as it will be printed — the select collapses it
              to one line, and an address is read in its own shape.
            */}
            {current !== "" && (
              <div className="mt-1.5 rounded-md bg-brand-50/60 px-2.5 py-1.5 ring-1 ring-inset ring-brand-100">
                <p className="whitespace-pre-line text-xs leading-4 text-slate-800">{current}</p>
                <p className="mt-0.5 text-xs leading-4 text-slate-500">
                  {savedElsewhere
                    ? SAVED_HERE
                    : SOURCE_LABEL[
                        choices.find((choice) => choice.address === current)?.source ?? "site"
                      ]}
                </p>
              </div>
            )}
          </>
        )}
        {shippingError && (
          <p
            id={`${SHIPPING_ID}-error`}
            className="mt-1 text-xs leading-4 font-medium text-rose-600"
            role="alert"
          >
            {shippingError}
          </p>
        )}
      </div>
    </div>
  );
}

const SHIPPING_ID = "shipping-address";

/** What a document carries that the site's list does not offer any more. */
const SAVED_HERE = "Saved on this document";

/** An address is stored with its line breaks; a dropdown option gets one line. */
const oneLine = (address: string): string => address.replace(/\s+/g, " ").trim();

/**
 * The choices under their source heading, in the order the server sent them.
 *
 * Not `Object.groupBy` or a Map keyed by source: both would reorder the groups
 * to key order, and the server sends the site's own address first on purpose.
 */
function groupBySource(choices: readonly AddressChoice[]) {
  const groups: { source: AddressChoice["source"]; choices: AddressChoice[] }[] = [];
  for (const choice of choices) {
    const existing = groups.find((group) => group.source === choice.source);
    if (existing) existing.choices.push(choice);
    else groups.push({ source: choice.source, choices: [choice] });
  }
  return groups;
}

const SOURCE_LABEL: Record<AddressChoice["source"], string> = {
  site: "Site address",
  "site-shipping": "Site shipping address",
  extra: "Site delivery address",
  location: "Location address",
};

