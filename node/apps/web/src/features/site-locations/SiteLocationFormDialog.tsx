import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, FormDialog, FormSection, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { useSiteList } from "../sites/api";
import { useSaveSiteLocations, useSiteLocations } from "./api";
import { SiteCombobox } from "./SiteCombobox";

/**
 * A site's locations and addresses — the Site Location form, 15 Sep 2026.
 *
 * In the order the business described it: FIRST the site, picked by typing;
 * THEN the location names, one box each, with a + to add the next; THEN the
 * addresses, as many as the site has.
 *
 * PICKING A SITE THAT ALREADY HAS LOCATIONS OPENS THEM. Someone who chooses
 * "Add" and picks a site with an entry is looking to change that site's list;
 * refusing with "already exists" would make them close the form and find the
 * row. The form loads what is there and says so.
 *
 * NO `react-hook-form`, as on the site groups form it replaces: both fields that
 * matter are lists, and the one scalar is a combobox with state of its own.
 *
 * Blank rows are dropped on save rather than refused. A + pressed once too often
 * is not a mistake worth a validation message.
 */
interface LocationDraft {
  /** The stored location's id; null for one added in this form. */
  id: string | null;
  name: string;
  /** Stable React key, because two new rows both have a null id. */
  key: number;
}

export function SiteLocationFormDialog({
  open,
  siteId,
  onClose,
}: {
  open: boolean;
  /** The site being edited, or null to add. */
  siteId: string | null;
  onClose: () => void;
}) {
  const isEdit = siteId !== null;
  const [chosenSiteId, setChosenSiteId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationDraft[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const focusKey = useRef<number | null>(null);

  const newRow = (name = "", id: string | null = null): LocationDraft => ({
    id,
    name,
    key: nextKey.current++,
  });

  /**
   * Every site, not the ones this person is scoped to: a master screen. A list
   * narrowed to someone's own sites would hide the sites they are here to set up.
   */
  const sites = useSiteList({ limit: 200, sortBy: "name", sortDir: "asc" });
  const siteRows = (sites.data?.rows ?? []).map((site) => ({ id: site.id, name: site.name }));

  const target = isEdit ? siteId : chosenSiteId;
  const detail = useSiteLocations(open && target ? target : null);
  const exists = (detail.data?.locations.length ?? 0) > 0 || (detail.data?.addresses.length ?? 0) > 0;
  const save = useSaveSiteLocations();

  /** The site whose stored rows are already in the form. */
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    loadedFor.current = null;
    setFormError(null);
    setChosenSiteId(null);
    setLocations([newRow()]);
    setAddresses([]);
  }, [open, siteId]);

  /**
   * Whatever the chosen site already holds replaces the rows — ONCE per site.
   * The query refetches on its own (a window regaining focus is enough), and
   * each refetch hands over a new `data`; applying every one of them would wipe
   * whatever had been typed since. The full suite caught exactly that.
   *
   * A site with no locations keeps a still-blank row rather than swapping it for
   * a new one, so the box the cursor is in is not replaced under it.
   */
  useEffect(() => {
    if (!open || !target || !detail.data || detail.data.siteId !== target) return;
    if (loadedFor.current === target) return;
    loadedFor.current = target;
    const stored = detail.data.locations;
    setLocations((current) =>
      stored.length > 0
        ? stored.map((row) => newRow(row.name, row.id))
        : current.length === 1 && current[0]!.id === null && current[0]!.name === ""
          ? current
          : [newRow()],
    );
    setAddresses(detail.data.addresses.map((row) => row.address));
  }, [open, target, detail.data]);

  const insertLocationAfter = (index: number) => {
    const row = newRow();
    focusKey.current = row.key;
    setLocations((current) => [...current.slice(0, index + 1), row, ...current.slice(index + 1)]);
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!target) {
      setFormError("Choose a site first");
      return;
    }

    const body = {
      locations: locations
        .map((row) => ({ id: row.id, name: row.name.trim() }))
        .filter((row) => row.name !== ""),
      addresses: addresses.map((address) => address.trim()).filter((address) => address !== ""),
    };

    try {
      await save.mutateAsync({ siteId: target, exists: isEdit || exists, body });
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "The locations could not be saved");
    }
  };

  const siteName = detail.data?.siteName ?? siteRows.find((row) => row.id === target)?.name;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? `Edit site location${siteName ? ` — ${siteName}` : ""}` : "Add site location"}
      description="Choose a site, then list the locations inside it and the addresses deliveries can go to"
      formError={formError}
      pending={save.isPending}
      submitLabel="Save"
    >
      <FormSection title="Site" columns={1}>
        {isEdit ? (
          <div>
            <div className="text-xs font-medium text-slate-600">Site</div>
            <div className="mt-1 text-sm font-medium text-slate-900">{siteName ?? "Loading…"}</div>
          </div>
        ) : (
          <SiteCombobox
            sites={siteRows}
            value={chosenSiteId}
            onChange={setChosenSiteId}
            loading={sites.isLoading}
          />
        )}
        {!isEdit && chosenSiteId && exists && (
          <Alert tone="info">
            This site already has locations. They are loaded below, and saving changes them.
          </Alert>
        )}
      </FormSection>

      {target && detail.isLoading ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading the site's locations…</p>
      ) : (
        <>
          <FormSection
            title="Locations"
            description="The places inside the site. Documents raised for the site can name one."
            columns={1}
          >
            <div className="space-y-2">
              {locations.map((row, index) => (
                <div key={row.key} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <TextField
                      label={`Location name ${index + 1}`}
                      labelHidden
                      placeholder="Location name, e.g. Block A"
                      value={row.name}
                      disabled={!target}
                      ref={(element) => {
                        if (element && focusKey.current === row.key) {
                          focusKey.current = null;
                          element.focus();
                        }
                      }}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        setLocations((current) =>
                          current.map((draft) => (draft.key === row.key ? { ...draft, name } : draft)),
                        );
                      }}
                      onKeyDown={(event) => {
                        // Enter adds the next location rather than submitting the form.
                        if (event.key === "Enter") {
                          event.preventDefault();
                          insertLocationAfter(index);
                        }
                      }}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    icon={Plus}
                    className="px-2 py-2"
                    disabled={!target}
                    aria-label={`Add a location after ${index + 1}`}
                    title="Add another location"
                    onClick={() => insertLocationAfter(index)}
                  />
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    className="px-2 py-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Remove location ${index + 1}`}
                    title={`Remove location ${index + 1}`}
                    disabled={!target}
                    onClick={() =>
                      setLocations((current) =>
                        current.length === 1
                          ? [newRow()]
                          : current.filter((draft) => draft.key !== row.key),
                      )
                    }
                  />
                </div>
              ))}
              {isEdit || exists ? (
                <p className="text-[11px] text-slate-500">
                  A location removed here stays on the orders and invoices that already name it.
                </p>
              ) : null}
            </div>
          </FormSection>

          <FormSection
            title="Addresses"
            description="Offered as shipping addresses on orders and invoices for this site"
            columns={1}
          >
            <div className="space-y-2">
              {addresses.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}

              {addresses.map((address, index) => (
                <div key={index} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    value={address}
                    disabled={!target}
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      setAddresses((current) => current.map((row, at) => (at === index ? text : row)));
                    }}
                    aria-label={`Address ${index + 1}`}
                    placeholder="Full address, with the PIN code"
                    className="min-w-0 flex-1 rounded-lg border-0 px-2.5 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
                  />
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    className="mt-1 px-2 py-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Remove address ${index + 1}`}
                    title={`Remove address ${index + 1}`}
                    onClick={() => setAddresses((current) => current.filter((_row, at) => at !== index))}
                  />
                </div>
              ))}

              <Button
                variant="secondary"
                icon={Plus}
                disabled={!target}
                onClick={() => setAddresses((current) => [...current, ""])}
              >
                Add address
              </Button>
            </div>
          </FormSection>
        </>
      )}
    </FormDialog>
  );
}
