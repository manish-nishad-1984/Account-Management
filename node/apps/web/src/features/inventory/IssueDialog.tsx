import { useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { createInventoryIssueSchema, type IssueSource } from "@accountmanagement/contracts";
import { Alert, Button, CheckboxField, Modal, SelectField, TextAreaField, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { AuthedPhoto, PhotoInput } from "./photos";
import {
  useAgencyPersons,
  useCreateAgencyPerson,
  useInventoryItems,
  useIssueAgencies,
  useIssueItem,
  usePurchaseStock,
} from "./stock-api";

const NEW_PERSON = "__new__";

/**
 * ISSUE AN ITEM (client, 26 Oct 2026): from the inventory item stock or the
 * purchase item stock of the site, to a person of an agency, through the
 * agency's main contact. The person is picked, or added here with a photo and a
 * mobile and kept for the next time. Returnable items wait on the dashboard to
 * be received back in the evening.
 *
 * `preset` opens it on one inventory item at its site - "Issue" on a New Arrival
 * (client, 2 Nov 2026).
 */
export function IssueDialog({
  open,
  onClose,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  preset?: { inventoryItemId: string; siteId: string | null } | null;
}) {
  const scope = useSiteScope();
  const [siteId, setSiteId] = useState("");
  const [source, setSource] = useState<IssueSource>("inventory");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [returnable, setReturnable] = useState(true);
  const [agencyId, setAgencyId] = useState("");
  const [contactId, setContactId] = useState("");
  const [personId, setPersonId] = useState("");
  const [newPerson, setNewPerson] = useState({ name: "", mobile: "", photoKey: null as string | null });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSiteId(preset?.siteId ?? scope.siteId ?? "");
    setSource("inventory");
    setItemId(preset?.inventoryItemId ?? "");
    setQuantity("");
    setReturnable(true);
    setAgencyId("");
    setContactId("");
    setPersonId("");
    setNewPerson({ name: "", mobile: "", photoKey: null });
    setNote("");
    setError(null);
    // Once per opening; the preset is read as it is when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope.siteId]);

  const inventoryItems = useInventoryItems(siteId || null);
  const purchaseItems = usePurchaseStock(siteId || null);
  const agencies = useIssueAgencies();
  const persons = useAgencyPersons(agencyId);
  const createPerson = useCreateAgencyPerson();
  const issue = useIssueItem();

  const options =
    source === "inventory"
      ? (inventoryItems.data?.rows ?? []).map((row) => ({ id: row.id, name: row.name, unit: row.unit, stock: row.stock, hasPhoto: row.hasPhoto }))
      : (purchaseItems.data ?? []).map((row) => ({ id: row.itemId, name: row.itemName, unit: row.unitName ?? "", stock: row.stock, hasPhoto: false }));
  const picked = options.find((row) => row.id === itemId);
  const agency = (agencies.data ?? []).find((row) => row.id === agencyId);
  const person = (persons.data ?? []).find((row) => row.id === personId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!siteId) return setError("Choose the site the item is issued from.");
    if (!agencyId) return setError("Choose the agency.");
    if (!personId) return setError("Choose the person, or add a new one.");
    if (personId === NEW_PERSON && !newPerson.name.trim()) return setError("Enter the new person's name.");
    try {
      let who = personId;
      if (personId === NEW_PERSON) {
        const created = await createPerson.mutateAsync({
          agencyId,
          name: newPerson.name.trim(),
          mobile: newPerson.mobile.trim() || null,
          photoKey: newPerson.photoKey,
        });
        who = created.id;
        setPersonId(created.id);
      }
      const parsed = createInventoryIssueSchema.safeParse({
        siteId,
        source,
        inventoryItemId: source === "inventory" ? itemId || null : null,
        itemId: source === "purchase" ? itemId || null : null,
        quantity,
        returnable,
        agencyId,
        agencyContactId: contactId || null,
        personId: who,
        note,
      });
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form.");
      await issue.mutateAsync(parsed.data);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The item could not be issued. Please try again.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Issue item"
      description={scope.siteName ? `From the stock of ${scope.siteName}` : "Give an item to an agency's person"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="issue-form" loading={issue.isPending || createPerson.isPending}>
            Issue
          </Button>
        </>
      }
    >
      <form id="issue-form" onSubmit={(event) => void submit(event)} className="space-y-4">
        {!scope.siteId && (
          <SelectField
            label="Site"
            required
            value={siteId}
            placeholder="Choose the site"
            options={scope.sites.map((site) => ({ value: site.id, label: site.name }))}
            onChange={(event) => {
              setSiteId(event.target.value);
              setItemId("");
            }}
          />
        )}

        <div role="radiogroup" aria-label="Issue from" className="inline-flex rounded-md ring-1 ring-inset ring-slate-300">
          {(
            [
              ["inventory", "Inventory item"],
              ["purchase", "Purchase item"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={source === value}
              onClick={() => {
                setSource(value);
                setItemId("");
                // Tools come back; what is bought is mostly used up.
                setReturnable(value === "inventory");
              }}
              className={clsx(
                "px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md",
                source === value ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <SelectField
              label="Item"
              required
              value={itemId}
              placeholder={siteId ? (options.length === 0 ? "Nothing in stock at this site" : "Choose the item") : "Choose the site first"}
              options={options.map((row) => ({ value: row.id, label: `${row.name} · in stock ${Number(row.stock)} ${row.unit}` }))}
              onChange={(event) => setItemId(event.target.value)}
            />
          </div>
          <TextField
            label="Quantity"
            required
            inputMode="decimal"
            value={quantity}
            hint={picked ? `In stock: ${Number(picked.stock)} ${picked.unit}` : undefined}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <CheckboxField
          label="Returnable — to be received back (shown on the dashboard until it is)"
          checked={returnable}
          onChange={(event) => setReturnable(event.target.checked)}
        />

        {/* What is being handed over, as a picture (client, 2 Nov 2026). */}
        {source === "inventory" && picked?.hasPhoto && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <AuthedPhoto path={`/inventory-items/${picked.id}/photo`} alt={picked.name} className="size-16" />
            {picked.name}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Agency"
            required
            value={agencyId}
            placeholder={agencies.isLoading ? "Loading…" : "Choose the agency"}
            options={(agencies.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
            onChange={(event) => {
              const next = (agencies.data ?? []).find((row) => row.id === event.target.value);
              setAgencyId(event.target.value);
              // The main contact is the agency's first.
              setContactId(next?.contacts[0]?.id ?? "");
              setPersonId("");
            }}
          />
          <SelectField
            label="Main contact"
            value={contactId}
            placeholder={agency ? (agency.contacts.length === 0 ? "No contacts in the Agency Master" : "Choose") : "Choose the agency first"}
            options={(agency?.contacts ?? []).map((row) => ({ value: row.id, label: [row.name, row.mobile].filter(Boolean).join(" · ") }))}
            onChange={(event) => setContactId(event.target.value)}
          />
        </div>

        {agencyId && (
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <SelectField
                  label="Person taking it"
                  required
                  value={personId}
                  placeholder={persons.isLoading ? "Loading…" : "Choose the person"}
                  options={[
                    ...(persons.data ?? []).map((row) => ({ value: row.id, label: [row.name, row.mobile].filter(Boolean).join(" · ") })),
                    { value: NEW_PERSON, label: "+ New person…" },
                  ]}
                  onChange={(event) => setPersonId(event.target.value)}
                />
              </div>
              {person?.hasPhoto && <AuthedPhoto path={`/agency-persons/${person.id}/photo`} alt={person.name} className="size-12" />}
            </div>
            {personId === NEW_PERSON && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextField label="Name" required value={newPerson.name} onChange={(event) => setNewPerson({ ...newPerson, name: event.target.value })} />
                <TextField
                  label="Mobile"
                  inputMode="tel"
                  value={newPerson.mobile}
                  onChange={(event) => setNewPerson({ ...newPerson, mobile: event.target.value })}
                />
                <div className="sm:col-span-2">
                  <PhotoInput label="Person's photo" onChange={(photoKey) => setNewPerson((current) => ({ ...current, photoKey }))} />
                </div>
              </div>
            )}
          </div>
        )}

        <TextAreaField label="Note" rows={1} value={note} onChange={(event) => setNote(event.target.value)} />
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}
