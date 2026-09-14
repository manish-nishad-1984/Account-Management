import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button, FormDialog, FormSection, TextField } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { useSiteList } from "../sites/api";
import {
  useCreateSiteGroup,
  useSiteGroup,
  useUpdateSiteGroup,
} from "./api";

/**
 * Creating and editing a site group.
 *
 * NO `react-hook-form` HERE, unlike every other master form, and that is the
 * shape of the thing rather than a preference: two of the three fields are
 * lists — the member sites and the group's addresses — and neither is an input
 * with a name that a resolver can bind to. What is left for a form library to do
 * is one text box.
 *
 * The lists are REPLACED on save rather than merged. The dialog shows the whole
 * membership, so a site the person unticked has to disappear; sending only what
 * changed would mean the screen and the server disagreeing about what a tick
 * means.
 */
export function SiteGroupFormDialog({
  open,
  groupId,
  onClose,
}: {
  open: boolean;
  groupId: string | null;
  onClose: () => void;
}) {
  const isEdit = groupId !== null;
  const detail = useSiteGroup(open && isEdit ? groupId : null);
  const create = useCreateSiteGroup();
  const update = useUpdateSiteGroup();

  const [name, setName] = useState("");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [siteSearch, setSiteSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Every site, not the ones this person is scoped to.
   *
   * A group is a MASTER: someone maintaining it is saying which sites belong
   * together, and a list filtered by their own site assignments would silently
   * drop members they cannot see — then delete them on save, because the save
   * replaces the list with what the screen was showing.
   */
  const sites = useSiteList({ limit: 200, sortBy: "name", sortDir: "asc" });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSiteSearch("");
    if (!isEdit) {
      setName("");
      setSiteIds([]);
      setAddresses([]);
    } else if (detail.data) {
      setName(detail.data.name);
      setSiteIds(detail.data.siteIds);
      setAddresses(detail.data.addresses.map((row) => row.address));
    }
  }, [open, isEdit, detail.data]);

  const pending = create.isPending || update.isPending;

  const visibleSites = useMemo(() => {
    const rows = sites.data?.rows ?? [];
    const term = siteSearch.trim().toLowerCase();
    if (term === "") return rows;
    // A member already ticked stays visible while searching, so that filtering
    // never hides what is about to be saved.
    return rows.filter(
      (site) => site.name.toLowerCase().includes(term) || siteIds.includes(site.id),
    );
  }, [sites.data?.rows, siteSearch, siteIds]);

  const toggleSite = (id: string) =>
    setSiteIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const onSubmit = async () => {
    setFormError(null);

    if (name.trim() === "") {
      setFormError("Group name is required");
      return;
    }

    const body = {
      name: name.trim(),
      siteIds,
      addresses: addresses.map((address) => address.trim()).filter((address) => address !== ""),
    };

    try {
      if (isEdit) {
        await update.mutateAsync({ id: groupId, body });
      } else {
        await create.mutateAsync(body);
      }
      onClose();
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.status === 409 || error.status === 400
            ? /*
                A duplicate name is the failure people will actually hit, and the
                server's own words are clearer than a generic sentence would be.
              */
              error.message
            : error.message
          : "The group could not be saved",
      );
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={isEdit ? "Edit site group" : "Add site group"}
      description="A named set of sites, with the addresses orders for the group can go to"
      formError={formError}
      pending={pending}
      submitLabel={isEdit ? "Save changes" : "Create group"}
    >
      {isEdit && detail.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading group…</p>
      ) : (
        <>
          <FormSection title="Group">
            <TextField
              label="Group name"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="sm:col-span-2"
            />
          </FormSection>

          <FormSection
            title="Sites"
            description={`${siteIds.length} of ${sites.data?.total ?? 0} selected`}
          >
            <div className="sm:col-span-2">
              <div className="relative mb-2">
                <input
                  value={siteSearch}
                  onChange={(event) => setSiteSearch(event.currentTarget.value)}
                  placeholder="Search sites…"
                  aria-label="Search sites"
                  className="w-full rounded-lg border-0 py-2 pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
                />
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                />
              </div>

              <div className="scroll-subtle max-h-56 overflow-y-auto rounded-lg ring-1 ring-inset ring-slate-200">
                {sites.isLoading && (
                  <p className="px-3 py-4 text-sm text-slate-500">Loading sites…</p>
                )}
                {!sites.isLoading && visibleSites.length === 0 && (
                  <p className="px-3 py-4 text-sm text-slate-500">No sites match that search.</p>
                )}
                {visibleSites.map((site) => (
                  <label
                    key={site.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={siteIds.includes(site.id)}
                      onChange={() => toggleSite(site.id)}
                      className="size-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="truncate text-slate-700">{site.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Group addresses"
            description="Offered as delivery addresses on orders raised for this group"
          >
            <div className="space-y-2 sm:col-span-2">
              {addresses.length === 0 && (
                <p className="text-sm text-slate-500">None yet.</p>
              )}

              {addresses.map((address, index) => (
                <div key={index} className="flex items-start gap-2">
                  <textarea
                    rows={2}
                    value={address}
                    onChange={(event) =>
                      setAddresses((current) =>
                        current.map((row, at) => (at === index ? event.target.value : row)),
                      )
                    }
                    aria-label={`Group address ${index + 1}`}
                    placeholder="Where deliveries for this group go"
                    className="min-w-0 flex-1 rounded-lg border-0 px-2.5 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    icon={Trash2}
                    className="mt-1 px-2 py-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={`Remove group address ${index + 1}`}
                    title={`Remove group address ${index + 1}`}
                    onClick={() =>
                      setAddresses((current) => current.filter((_row, at) => at !== index))
                    }
                  />
                </div>
              ))}

              <Button
                type="button"
                variant="secondary"
                icon={Plus}
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
