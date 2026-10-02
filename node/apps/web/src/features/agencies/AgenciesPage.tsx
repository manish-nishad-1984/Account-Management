import { useMemo, useState } from "react";
import clsx from "clsx";
import type { ColumnDef } from "@tanstack/react-table";
import { AGENCY_SORT_FIELDS, type AgencyRow } from "@accountmanagement/contracts";
import { CheckCircle2, PauseCircle, Plus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import { useAgencyList, useAgencySummary, useDeleteAgency, useWorkTypes } from "./api";
import { AgencyFormDialog } from "./AgencyFormDialog";
import { WorkTypeTag } from "./WorkTypeTag";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

/**
 * Agency Master — the contractors who work on a site (client request, 1 Oct
 * 2026, from a mockup): three count tiles, a search with three filters, and a
 * row per agency showing its trades as tags and who to call.
 *
 * The tiles count every agency whatever the filters say — they are the size
 * of the master, not of the current search — and clicking one sets the Status
 * filter, so "Inactive 1" is one click from that one row.
 */

type StatusFilter = "all" | "active" | "inactive";

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const Absent = () => <span className="text-slate-300">—</span>;

export function AgenciesPage() {
  const canAdd = usePermission("agency", "add");
  const screen = useMasterScreen<AgencyRow>({ defaultSortBy: "name" });
  const summary = useAgencySummary();
  const workTypes = useWorkTypes();
  const remove = useDeleteAgency();

  const [workTypeId, setWorkTypeId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cityId, setCityId] = useState("");

  const query = useAgencyList(screen.listParams, {
    workTypeId: workTypeId ? Number(workTypeId) : undefined,
    cityId: cityId ? Number(cityId) : undefined,
    isActive: status === "all" ? undefined : status === "active",
  });

  // A cursor carried across a filter change seeks into a set that no longer
  // exists, and keyset paging gives no error for that (§5j).
  const { resetPaging, openEdit, askDelete } = screen;
  const filterBy = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    resetPaging();
  };

  const columns = useMemo<ColumnDef<AgencyRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Agency name",
        cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span>,
      },
      {
        id: "workTypes",
        header: "Work nature / services",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.workTypes.map((type) => (
              <WorkTypeTag key={type.id} id={type.id} name={type.name} />
            ))}
          </div>
        ),
      },
      {
        id: "city",
        header: "City",
        cell: ({ row }) => (row.original.cityName ? <span className="text-slate-700">{row.original.cityName}</span> : <Absent />),
      },
      {
        id: "contact",
        header: "Primary contact",
        cell: ({ row }) =>
          row.original.primaryContactName ? (
            <div>
              <div className="text-slate-800">{row.original.primaryContactName}</div>
              <div className="tabular text-xs text-slate-500">{row.original.primaryContactMobile ?? ""}</div>
            </div>
          ) : (
            <Absent />
          ),
      },
      {
        id: "isActive",
        header: "Status",
        cell: ({ row }) => (
          <Badge dot tone={row.original.isActive ? "success" : "danger"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActions
            capabilities={row.original.capabilities}
            label={row.original.name}
            onEdit={() => openEdit(row.original.id)}
            onDelete={() => askDelete(row.original)}
          />
        ),
      },
    ],
    [openEdit, askDelete],
  );

  const counts = summary.data;
  const tiles: Array<{ filter: StatusFilter; label: string; value: number | undefined; icon: LucideIcon; tone: string }> = [
    { filter: "all", label: "Total agencies", value: counts?.total, icon: Users, tone: "sky" },
    { filter: "active", label: "Active agencies", value: counts?.active, icon: CheckCircle2, tone: "emerald" },
    { filter: "inactive", label: "Inactive agencies", value: counts?.inactive, icon: PauseCircle, tone: "rose" },
  ];

  return (
    <>
      <PageHeader title="Agency Master" description="Contractors and agencies, and the work they do" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <StatTile
            key={tile.filter}
            label={tile.label}
            value={tile.value}
            icon={tile.icon}
            tone={tile.tone}
            selected={status === tile.filter}
            onClick={() => filterBy(setStatus)(tile.filter)}
          />
        ))}
      </div>

      <DataGrid<AgencyRow>
        filters={
          <>
            <SelectField
              labelHidden
              label="Work type"
              value={workTypeId}
              onChange={(event) => filterBy(setWorkTypeId)(event.target.value)}
              options={[
                { value: "", label: "All work types" },
                ...(workTypes.data ?? []).map((type) => ({ value: String(type.id), label: type.name })),
              ]}
            />
            <SelectField
              labelHidden
              label="Status"
              value={status}
              onChange={(event) => filterBy(setStatus)(event.target.value as StatusFilter)}
              options={STATUS_OPTIONS}
            />
            <SelectField
              labelHidden
              label="City"
              value={cityId}
              onChange={(event) => filterBy(setCityId)(event.target.value)}
              options={[
                { value: "", label: "All cities" },
                ...(counts?.cities ?? []).map((city) => ({ value: String(city.id), label: city.name })),
              ]}
            />
          </>
        }
        actions={
          canAdd ? (
            <Button icon={Plus} onClick={screen.openCreate}>
              Add agency
            </Button>
          ) : undefined
        }
        gridKey="agencies"
        columns={columns}
        searchPlaceholder="Search by agency name, contact, service…"
        sortableFields={AGENCY_SORT_FIELDS}
        emptyMessage="No agencies match this search"
        {...screen.gridProps(query)}
      />

      <AgencyFormDialog open={screen.isFormOpen} agencyId={screen.editingId} onClose={screen.closeForm} />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete agency"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The agency is hidden from every list. To stop using an agency but keep it on record, edit it and
              untick Active instead.
            </p>
          </>
        }
      />
    </>
  );
}

const TILE_TONES: Record<string, { tile: string; icon: string; count: string; ring: string }> = {
  sky: { tile: "bg-sky-50 ring-sky-200 hover:bg-sky-100", icon: "bg-sky-600", count: "text-sky-900", ring: "ring-2 ring-sky-500" },
  emerald: {
    tile: "bg-emerald-50 ring-emerald-200 hover:bg-emerald-100",
    icon: "bg-emerald-600",
    count: "text-emerald-900",
    ring: "ring-2 ring-emerald-500",
  },
  rose: { tile: "bg-rose-50 ring-rose-200 hover:bg-rose-100", icon: "bg-rose-600", count: "text-rose-900", ring: "ring-2 ring-rose-500" },
};

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
  selected,
  onClick,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  tone: string;
  selected: boolean;
  onClick: () => void;
}) {
  const colours = TILE_TONES[tone]!;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-inset transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        colours.tile,
        selected && colours.ring,
      )}
    >
      <span className={clsx("grid size-10 shrink-0 place-items-center rounded-full text-white", colours.icon)}>
        <Icon aria-hidden className="size-5" />
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        <span className={clsx("tabular block text-2xl font-semibold leading-tight", colours.count)}>
          {value ?? "…"}
        </span>
      </span>
    </button>
  );
}
