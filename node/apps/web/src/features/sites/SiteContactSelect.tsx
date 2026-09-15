import { SelectField } from "../../components/ui";
import { useSiteDocumentOptions } from "./api";

/**
 * The document's contact person, picked from the site's contact list.
 *
 * THE RULE THE BUSINESS SET ON 15 Sep 2026: the contacts are entered ONCE, on
 * the Site master, and an order or invoice picks one of them rather than having
 * a name and a number typed again. The choice is COPIED onto the document's own
 * `contactName` / `contactNumber` — the columns it has always had, which the
 * print layouts already read — so editing the site's contacts later does not
 * rewrite who a past order named. It is also why there is no id to store: the
 * Site master replaces its contact rows on every save.
 *
 * A document raised before this rule may name someone who is not on the site's
 * list — typed by hand on the old form. That contact is shown as "saved on this
 * document" and stays chosen until someone picks another, rather than being
 * blanked by merely opening the form.
 *
 * Changing the SITE clears the contact, in each form's Site select `onChange`,
 * for the same reason `SiteAddressFields` gives for the shipping address.
 */
export function SiteContactSelect({
  siteId,
  name,
  number,
  onChange,
  error,
}: {
  siteId: string | null | undefined;
  name: string | null | undefined;
  number: string | null | undefined;
  onChange: (name: string, number: string) => void;
  error?: string;
}) {
  const chosenSite = siteId && siteId !== "" ? siteId : null;
  const options = useSiteDocumentOptions(chosenSite);
  const contacts = options.data?.contacts ?? [];

  const currentName = (name ?? "").trim();
  const currentNumber = (number ?? "").trim();
  const matches = contacts.findIndex(
    (contact) => (contact.name ?? "") === currentName && (contact.phone ?? "") === currentNumber,
  );
  const savedElsewhere = matches < 0 && (currentName !== "" || currentNumber !== "");

  const describe = (contactName: string, phone: string) =>
    [contactName, phone].filter((part) => part !== "").join(" — ");

  const selectOptions = [
    { value: "", label: "No contact" },
    ...(savedElsewhere
      ? [{ value: "saved", label: `${describe(currentName, currentNumber)} (saved on this document)` }]
      : []),
    ...contacts.map((contact, index) => ({
      value: String(index),
      label: describe(contact.name ?? "", contact.phone ?? ""),
    })),
  ];

  const value = matches >= 0 ? String(matches) : savedElsewhere ? "saved" : "";

  return (
    <SelectField
      label="Contact person"
      options={selectOptions}
      disabled={!chosenSite}
      hint={
        !chosenSite
          ? "Choose a site first"
          : options.isLoading
            ? "Loading contacts…"
            : contacts.length === 0
              ? "This site has no contacts. Add them on the Sites screen."
              : "From the site's contacts on the Sites screen"
      }
      error={error}
      value={value}
      onChange={(event) => {
        const picked = event.target.value;
        if (picked === "saved") return;
        const contact = picked === "" ? null : contacts[Number(picked)];
        onChange(contact?.name ?? "", contact?.phone ?? "");
      }}
    />
  );
}
