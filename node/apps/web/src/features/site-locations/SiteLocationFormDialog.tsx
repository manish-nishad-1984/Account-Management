import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Building2, MapPin, Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  FormDialog,
  FormSection,
  IconButton,
  TextField,
} from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { CONTROL_BASE, ringFor } from "../../components/ui/fields";
import { useSiteList } from "../sites/api";
import { useSaveSiteLocations, useSiteLocations } from "./api";
import { SiteCombobox } from "./SiteCombobox";

/**
 * A site's locations, each with the address deliveries to it go to — the Site
 * Location form.
 *
 * ONE LIST OF PAIRS since 17 Sep 2026. It was two independent lists, chosen by
 * the business on 15 Sep and reversed by them two days later: "Block A" and
 * "Plot 5, Bardoli Road" are one place, and two lists could not say which
 * address belonged to which block — the one thing a delivery needs to know.
 *
 * PICKING A SITE THAT ALREADY HAS PAIRS OPENS THEM. Someone who chooses "Add"
 * and picks a site with an entry is looking to change that site's list; refusing
 * with "already exists" would make them close the form and find the row. The
 * form loads what is there and says so.
 *
 * EITHER HALF MAY BE LEFT BLANK, and that is not laxness. Migration 0020 carried
 * every address from the old two-list shape across as a pair with NO NAME —
 * nothing recorded which name went with which address, and inventing a pairing
 * would have put a wrong address on a live site. Those rows are what this form
 * exists to let someone name. A row with both halves blank is dropped on save.
 *
 * NO `react-hook-form`: the field that matters is a list, and the one scalar is
 * a combobox with state of its own.
 */
interface PairDraft {
  /** The stored location's id; null for one added in this form. */
  id: string | null;
  name: string;
  address: string;
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
  const [pairs, setPairs] = useState<PairDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const focusKey = useRef<number | null>(null);

  const newRow = (name = "", address = "", id: string | null = null): PairDraft => ({
    id,
    name,
    address,
    key: nextKey.current++,
  });

  const isBlank = (row: PairDraft) => row.name.trim() === "" && row.address.trim() === "";

  /**
   * Every site, not the ones this person is scoped to: a master screen. A list
   * narrowed to someone's own sites would hide the sites they are here to set up.
   */
  const sites = useSiteList({ limit: 200, sortBy: "name", sortDir: "asc" });
  const siteRows = (sites.data?.rows ?? []).map((site) => ({ id: site.id, name: site.name }));

  const target = isEdit ? siteId : chosenSiteId;
  const detail = useSiteLocations(open && target ? target : null);
  const exists = (detail.data?.locations.length ?? 0) > 0;
  const save = useSaveSiteLocations();

  /** The site whose stored rows are already in the form. */
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    loadedFor.current = null;
    setFormError(null);
    setChosenSiteId(null);
    setPairs([newRow()]);
  }, [open, siteId]);

  /**
   * Whatever the chosen site already holds replaces the rows — ONCE per site.
   * The query refetches on its own (a window regaining focus is enough), and
   * each refetch hands over a new `data`; applying every one of them would wipe
   * whatever had been typed since. The full suite caught exactly that.
   *
   * A site with no pairs keeps a still-blank row rather than swapping it for a
   * new one, so the box the cursor is in is not replaced under it.
   */
  useEffect(() => {
    if (!open || !target || !detail.data || detail.data.siteId !== target) return;
    if (loadedFor.current === target) return;
    loadedFor.current = target;
    const stored = detail.data.locations;
    setPairs((current) =>
      stored.length > 0
        ? stored.map((row) => newRow(row.name, row.address, row.id))
        : current.length === 1 && current[0]!.id === null && isBlank(current[0]!)
          ? current
          : [newRow()],
    );
  }, [open, target, detail.data]);

  const insertAfter = (index: number) => {
    const row = newRow();
    focusKey.current = row.key;
    setPairs((current) => [...current.slice(0, index + 1), row, ...current.slice(index + 1)]);
  };

  const patch = (key: number, change: Partial<PairDraft>) =>
    setPairs((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const onSubmit = async () => {
    setFormError(null);
    if (!target) {
      setFormError("Choose a site first");
      return;
    }

    const body = {
      locations: pairs
        .map((row) => ({ id: row.id, name: row.name.trim(), address: row.address.trim() }))
        .filter((row) => row.name !== "" || row.address !== ""),
    };

    try {
      await save.mutateAsync({ siteId: target, exists: isEdit || exists, body });
      onClose();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "The locations could not be saved");
    }
  };

  const siteName = detail.data?.siteName ?? siteRows.find((row) => row.id === target)?.name;

  /** Rows carried over by the migration: an address, still waiting for a name. */
  const unnamed = pairs.filter((row) => row.name.trim() === "" && row.address.trim() !== "").length;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? `Edit site location${siteName ? ` — ${siteName}` : ""}` : "Add site location"}
      description="Choose a site, then add each location with the address deliveries to it go to"
      formError={formError}
      pending={save.isPending}
      submitLabel="Save"
    >
      <FormSection icon={Building2} title="Site" columns={1}>
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
        <FormSection
          title="Locations and addresses"
          icon={MapPin}
          description="One row per place: what it is called, and where deliveries to it go"
          columns={1}
        >
          <div className="space-y-2">
            {/*
              Says which box is which ONCE, instead of a label on every row.
              Hidden below `sm`, where the two boxes stack and their placeholders
              do the same job with less furniture.
            */}
            <div className="hidden gap-2 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
              <span className="text-xs font-medium text-slate-600">Location</span>
              <span className="text-xs font-medium text-slate-600">Address</span>
              {/* Holds the headings over their boxes, clear of the two buttons. */}
              <span className="w-[4.5rem]" aria-hidden />
            </div>

            {unnamed > 0 && (
              <Alert tone="info">
                {unnamed === 1
                  ? "One address here has no location name yet."
                  : `${unnamed} addresses here have no location name yet.`}{" "}
                They came from the old separate address list, which never recorded which
                location each one belonged to. Name them as you go — nothing is lost
                meanwhile, and they are still offered as shipping addresses.
              </Alert>
            )}

            {pairs.map((row, index) => (
              <div key={row.key} className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <TextField
                    label={`Location name ${index + 1}`}
                    labelHidden
                    placeholder="e.g. Block A"
                    value={row.name}
                    disabled={!target}
                    ref={(element) => {
                      if (element && focusKey.current === row.key) {
                        focusKey.current = null;
                        element.focus();
                      }
                    }}
                    onChange={(event) => patch(row.key, { name: event.currentTarget.value })}
                    onKeyDown={(event) => {
                      // Enter adds the next pair rather than submitting the form.
                      if (event.key === "Enter") {
                        event.preventDefault();
                        insertAfter(index);
                      }
                    }}
                  />
                  <textarea
                    rows={2}
                    value={row.address}
                    disabled={!target}
                    onChange={(event) => patch(row.key, { address: event.currentTarget.value })}
                    aria-label={`Address ${index + 1}`}
                    placeholder="Full address, with the PIN code"
                    className={clsx(CONTROL_BASE, ringFor(undefined), "min-w-0 px-2.5")}
                  />
                </div>
                <IconButton
                  label={`Add a location after ${index + 1}`}
                  icon={Plus}
                  tone="operation"
                  size="md"
                  onClick={() => insertAfter(index)}
                  disabled={!target}
                />
                <IconButton
                  label={`Remove location ${index + 1}`}
                  icon={Trash2}
                  tone="destructive"
                  size="md"
                  onClick={() =>
                    setPairs((current) =>
                      current.length === 1 ? [newRow()] : current.filter((d) => d.key !== row.key),
                    )
                  }
                  disabled={!target}
                />
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              icon={Plus}
              disabled={!target}
              onClick={() => insertAfter(pairs.length - 1)}
            >
              Add pair
            </Button>

            {isEdit || exists ? (
              <p className="text-xs text-slate-500">
                A location removed here stays on the orders and invoices that already name it.
              </p>
            ) : null}
          </div>
        </FormSection>
      )}
    </FormDialog>
  );
}
