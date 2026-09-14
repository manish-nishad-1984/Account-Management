import { SelectField } from "../../components/ui";
import { useAddressChoices } from "./api";

/**
 * Pick one of a site's addresses, and drop it into the document.
 *
 * A CONTROL, NOT A FIELD. Nothing is stored about which address was chosen: the
 * text is copied into the document's own shipping address, which the person can
 * then edit, and the select goes back to its prompt. That is the behaviour the
 * source has — an order records the address it was placed against as TEXT, so
 * correcting a site's address later cannot rewrite where a delivery already
 * went — and it is the right behaviour for a document besides.
 *
 * It renders NOTHING at all until a site is chosen, and nothing when that site
 * has no address worth offering. A dropdown whose only option is "Choose an
 * address" is a control that looks broken.
 */
export function AddressPicker({
  siteId,
  onChoose,
}: {
  siteId: string | null;
  onChoose: (address: string) => void;
}) {
  const choices = useAddressChoices(siteId && siteId !== "" ? siteId : null);

  if (!siteId || (choices.data?.length ?? 0) === 0) {
    return null;
  }

  return (
    <SelectField
      label="Use a site address"
      hint="Copies it below, where it can still be edited"
      value=""
      onChange={(event) => {
        const chosen = choices.data?.find((row) => row.key === event.target.value);
        if (chosen) onChoose(chosen.address);
      }}
      options={[
        { value: "", label: "Choose an address…" },
        ...(choices.data ?? []).map((row) => ({
          value: row.key,
          /**
           * The whole address is the label, because the alternative is a list of
           * indistinguishable entries: these rows have no name, no nickname and
           * no label column — the source table is four columns wide and one of
           * them is the text itself.
           */
          label: row.source === "site" ? `Site address — ${row.address}` : row.address,
        })),
      ]}
    />
  );
}
