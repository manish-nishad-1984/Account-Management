import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import type { ColumnDef } from "@tanstack/react-table";
import {
  INVENTORY_INWARD_SORT_FIELDS,
  type InventoryInwardRow,
} from "@accountmanagement/contracts";
import { Check, HandHelping, Info, LayoutGrid, List, Package, Pencil, Plus, Undo2 } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import { exportDate, exportYesNo, type ExportColumn } from "../../lib/grid-export";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  PageHeader,
  SelectField,
} from "../../components/ui";
import {
  useDeleteInventoryInward,
  useInventoryInwardList,
  useSetInventoryApproval,
} from "./api";
import { InventoryFormDialog } from "./InventoryFormDialog";
import { IssueDialog } from "./IssueDialog";
import { ArrivalPiecesDialog } from "./ArrivalPiecesDialog";
import { IssuesView } from "./IssueLists";
import { StockView } from "./StockView";
import { AuthedPhoto } from "./photos";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { formatDate, formatQuantity } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

/** What the sheet holds, column for column — the screen's own columns, as text. */
export const EXPORT_COLUMNS: ExportColumn<InventoryInwardRow>[] = [
  { header: "Item", width: 34, value: (row) => row.itemName },
  { header: "Details", width: 30, value: (row) => row.details },
  { header: "Date", width: 12, value: (row) => exportDate(row.documentDate) },
  { header: "Quantity", width: 12, align: "right", value: (row) => row.quantity },
  { header: "Unit", width: 10, value: (row) => row.unitName },
  { header: "Site", width: 24, value: (row) => row.siteName },
  { header: "Approved", width: 10, value: (row) => exportYesNo(row.isApproved) },
  { header: "Created", width: 12, value: (row) => exportDate(row.createdAt) },
];

type ApprovalFilter = "all" | "pending" | "approved";

const APPROVAL_OPTIONS = [
  { value: "all", label: "All arrivals" },
  { value: "pending", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
];

/** The list as a table or as thumbnails (client, 2 Nov 2026); remembered in this browser. */
type ArrivalsLook = "list" | "thumbs";
const LOOK_KEY = "inventory-arrivals-look";
const readLook = (): ArrivalsLook => {
  try {
    return window.localStorage.getItem(LOOK_KEY) === "thumbs" ? "thumbs" : "list";
  } catch {
    return "list";
  }
};

/** The arrival's first photo: its own, else its first piece's. Null when it has none. */
export const arrivalPhotoPath = (row: InventoryInwardRow): string | null => {
  if (row.hasPhoto) return `/inventory-issues/arrivals/${row.id}/photo`;
  const n = row.pieces.findIndex((piece) => piece.hasPhoto);
  return n >= 0 ? `/inventory-issues/arrivals/${row.id}/pieces/${n}/photo` : null;
};

type Tab = "arrivals" | "stock" | "issues";
const TABS: { key: Tab; label: string }[] = [
  { key: "arrivals", label: "New arrivals" },
  { key: "stock", label: "Stock" },
  { key: "issues", label: "Issued items" },
];

/**
 * INVENTORY (client, 26 Oct 2026): New Arrival brings stock into the inventory
 * item master; Stock shows it, and the purchase items' own stock; Issued items
 * are what was given to an agency's people, and what is to come back.
 */
export function InventoryPage() {
  const canAdd = usePermission("inventory-inward", "add");
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((one) => one.key === params.get("tab")) ? (params.get("tab") as Tab) : "arrivals";
  const [issuing, setIssuing] = useState(false);
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock arriving at a site, issued to agencies and received back"
        actions={
          canAdd ? (
            <Button icon={HandHelping} onClick={() => setIssuing(true)}>
              Issue item
            </Button>
          ) : undefined
        }
      />
      <div role="tablist" aria-label="Inventory" className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((one) => (
          <button
            key={one.key}
            type="button"
            role="tab"
            aria-selected={tab === one.key}
            onClick={() => setParams(one.key === "arrivals" ? {} : { tab: one.key }, { replace: true })}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === one.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {one.label}
          </button>
        ))}
      </div>
      {tab === "arrivals" ? <ArrivalsView /> : tab === "stock" ? <StockView /> : <IssuesView />}
      <IssueDialog open={issuing} onClose={() => setIssuing(false)} />
    </>
  );
}

function ArrivalsView() {
  const canAdd = usePermission("inventory-inward", "add");
  const screen = useMasterScreen<InventoryInwardRow>({
    defaultSortBy: "createdAt",
    defaultSortDir: "desc",
  });

  const [approval, setApproval] = useState<ApprovalFilter>("all");
  const [look, setLookState] = useState<ArrivalsLook>(readLook);
  const setLook = (next: ArrivalsLook) => {
    setLookState(next);
    try {
      window.localStorage.setItem(LOOK_KEY, next);
    } catch {
      // Private window: the choice lasts until the page is left.
    }
  };
  // ISSUE FROM THE ARRIVAL (client, 2 Nov 2026): its item at its site, ready to issue.
  const [issueFor, setIssueFor] = useState<Parameters<typeof IssueDialog>[0]["preset"]>(null);
  // An arrival opened to its pieces (client, 2 Nov 2026).
  const [piecesOf, setPiecesOf] = useState<InventoryInwardRow | null>(null);
  const issueButton = (row: InventoryInwardRow, label = false) =>
    canAdd && row.inventoryItemId ? (
      <Button
        variant={label ? "secondary" : "ghost"}
        size={label ? "sm" : undefined}
        icon={HandHelping}
        title={`Issue ${row.itemName}`}
        aria-label={`Issue ${row.itemName}`}
        onClick={() => setIssueFor({ inventoryItemId: row.inventoryItemId!, siteId: row.siteId })}
      >
        {label ? "Issue" : undefined}
      </Button>
    ) : null;

  const scope = useSiteScope();
  const listFilters = {
    isApproved: approval === "all" ? undefined : approval === "approved",
  };
  const query = useInventoryInwardList(screen.listParams, listFilters);
  const remove = useDeleteInventoryInward();
  const setApprovalMutation = useSetInventoryApproval();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<InventoryInwardRow, unknown>[]>(
    () => [
      {
        id: "itemName",
        header: "Item",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            {row.original.hasPhoto && (
              <AuthedPhoto path={`/inventory-issues/arrivals/${row.original.id}/photo`} alt={row.original.itemName} className="size-9" />
            )}
            <div>
              <div className="font-medium text-slate-900">
                {row.original.itemName}
              </div>
              {row.original.details && (
                <div className="text-xs text-slate-500">
                  {row.original.details}
                </div>
              )}
              {/* Each piece's tag and photo (client, 30 Oct 2026). */}
              {row.original.pieces.length > 0 && (
                <button type="button" onClick={() => setPiecesOf(row.original)} className="text-xs font-medium text-brand-700 hover:underline">
                  {row.original.pieces.length} {row.original.pieces.length === 1 ? "piece" : "pieces"}
                  {row.original.pieces.some((piece) => piece.out) && ` · ${row.original.pieces.filter((piece) => piece.out).length} issued`}
                </button>
              )}
              {row.original.pieces.some((piece) => piece.tag) && (
                <div className="text-xs text-slate-500">
                  Tags: {row.original.pieces.map((piece) => piece.tag).filter(Boolean).join(", ")}
                </div>
              )}
              {row.original.pieces.some((piece) => piece.hasPhoto) && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {/* The first few; the rest are on the arrival itself. */}
                  {row.original.pieces
                    .map((piece, n) => ({ ...piece, n }))
                    .filter((piece) => piece.hasPhoto)
                    .slice(0, 6)
                    .map((piece) => (
                      <AuthedPhoto
                        key={piece.n}
                        path={`/inventory-issues/arrivals/${row.original.id}/pieces/${piece.n}/photo`}
                        alt={`${row.original.itemName} ${piece.tag || piece.n + 1}`}
                        className="size-8"
                      />
                    ))}
                  {row.original.pieces.filter((piece) => piece.hasPhoto).length > 6 && (
                    <span className="text-xs text-slate-500">+{row.original.pieces.filter((piece) => piece.hasPhoto).length - 6}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "documentDate",
        header: "Date",
        cell: ({ row }) => (
          <span className="tabular text-slate-600">
            {formatDate(row.original.documentDate) || <Absent />}
          </span>
        ),
      },
      {
        id: "quantity",
        header: "Quantity",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular block text-right text-slate-800">
            {formatQuantity(row.original.quantity)}{" "}
            <span className="text-xs text-slate-500">
              {row.original.unitName}
            </span>
          </span>
        ),
      },
      {
        id: "siteName",
        header: "Site",
        cell: ({ row }) =>
          row.original.siteName ? (
            <span className="text-slate-600">{row.original.siteName}</span>
          ) : (
            // Not an error and not missing data — the old form had no site field
            // at all, so nothing could have filled this in.
            <span
              className="text-xs text-slate-400"
              title="The old form had no site field"
            >
              No site recorded
            </span>
          ),
      },
      {
        id: "isApproved",
        header: "Status",
        cell: ({ row }) => (
          <Badge dot tone={row.original.isApproved ? "success" : "warning"}>
            {row.original.isApproved ? "Approved" : "Awaiting approval"}
          </Badge>
        ),
      },
      {
        id: "createdAt",
        header: "Created",
        meta: { defaultHidden: true },
        cell: ({ row }) =>
          row.original.createdAt ? (
            <span className="tabular text-slate-600">
              {formatDate(row.original.createdAt)}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {issueButton(row.original)}
            {row.original.capabilities.canApprove && (
              <Button
                variant="ghost"
                icon={row.original.isApproved ? Undo2 : Check}
                title={
                  row.original.isApproved
                    ? `Withdraw approval of ${row.original.itemName}`
                    : `Approve ${row.original.itemName}`
                }
                disabled={setApprovalMutation.isPending}
                onClick={() =>
                  setApprovalMutation.mutate({
                    id: row.original.id,
                    // Stated, not toggled from what is on screen.
                    isApproved: !row.original.isApproved,
                  })
                }
              />
            )}
            <RowActions
              capabilities={row.original.capabilities}
              label={row.original.itemName}
              onEdit={() => openEdit(row.original.id)}
              onDelete={() => askDelete(row.original)}
            />
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openEdit, askDelete, setApprovalMutation, canAdd],
  );

  const unallocated = query.data?.unallocated ?? 0;

  return (
    <>

      {/*
        Says WHY a site-scoped list is showing rows that belong to no site.
        Without it the site filter looks broken. Shown only while such rows
        exist, and only while a site is actually chosen.
      */}
      {unallocated > 0 && scope.siteId !== null && (
        <Alert tone="info" icon={Info} className="mb-4">
          {unallocated} arrival{unallocated === 1 ? "" : "s"} recorded before
          this system have no site against them — the old screen had no site
          field — so they are shown under every site. New arrivals are recorded
          against{" "}
          <span className="font-medium">
            {scope.siteName ?? "the chosen site"}
          </span>
          .
        </Alert>
      )}

      <DataGrid<InventoryInwardRow>
        // One row above the grid (client request, 18 Sep 2026): the screen's
        // filters beside the search box and its actions at the right-hand end.
        filters={
          <div className="flex items-center gap-2">
            <SelectField
              labelHidden
              label="Status"
              value={approval}
              options={APPROVAL_OPTIONS}
              onChange={(event) =>
                setApproval(event.target.value as ApprovalFilter)
              }
            />
            <div role="radiogroup" aria-label="Show as" className="inline-flex rounded-md ring-1 ring-inset ring-slate-300">
              {(
                [
                  ["list", "List", List],
                  ["thumbs", "Thumbnails", LayoutGrid],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={look === value}
                  title={label}
                  onClick={() => setLook(value)}
                  className={clsx(
                    "inline-flex h-9 items-center gap-1.5 px-2.5 text-xs font-medium first:rounded-l-md last:rounded-r-md",
                    look === value ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        }
        cards={
          look === "thumbs"
            ? (rows) => (
                <ul aria-label="Arrivals" className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {rows.map((row) => (
                    <ArrivalCard
                      key={row.id}
                      row={row}
                      issue={issueButton(row, true)}
                      onEdit={row.capabilities.canEdit ? () => openEdit(row.id) : undefined}
                      onOpen={() => setPiecesOf(row)}
                    />
                  ))}
                </ul>
              )
            : undefined
        }
        actions={
          <>
            <ExportExcelButton<InventoryInwardRow>
              resource="inventory-inward"
              params={screen.listParams}
              // The list hook adds the scoped site itself; the export must too.
              filters={{ ...listFilters, siteId: scope.siteId ?? undefined }}
              columns={EXPORT_COLUMNS}
              sheetName="Inventory Inward"
              fileName="Inventory-Inward"
              disabled={!scope.isReady}
            />
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                New arrival
              </Button>
            )}
          </>
        }
        gridKey="inventory"
        columns={columns}
        searchPlaceholder="Search item, unit or details"
        sortableFields={INVENTORY_INWARD_SORT_FIELDS}
        emptyMessage="No inventory arrivals match these filters"
        {...screen.gridProps(query)}
        isLoading={query.isLoading || !scope.isReady}
      />

      <IssueDialog open={!!issueFor} preset={issueFor} onClose={() => setIssueFor(null)} />
      <ArrivalPiecesDialog
        arrival={piecesOf}
        canIssue={canAdd}
        onClose={() => setPiecesOf(null)}
        onIssue={(arrival, chosen) => {
          setPiecesOf(null);
          setIssueFor({ inventoryItemId: arrival.inventoryItemId!, siteId: arrival.siteId, pieces: chosen });
        }}
      />

      <InventoryFormDialog
        open={screen.isFormOpen}
        recordId={screen.editingId}
        onClose={screen.closeForm}
      />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete inventory arrival"
        body={
          <>
            <p>
              Delete the arrival of{" "}
              <span className="font-medium text-slate-900">
                {screen.deleteTarget?.itemName}
              </span>
              ?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The row is marked deleted and hidden from every list. The old
              system removed the row outright; this one keeps it.
            </p>
          </>
        }
      />
    </>
  );
}

/** One arrival as a thumbnail: its photo, name, quantity, site and date, and Issue. */
function ArrivalCard({
  row,
  issue,
  onEdit,
  onOpen,
}: {
  row: InventoryInwardRow;
  issue: ReactNode;
  onEdit?: () => void;
  /** The photo opens the arrival's pieces, each with its own photo. */
  onOpen: () => void;
}) {
  const photo = arrivalPhotoPath(row);
  const tags = row.pieces.map((piece) => piece.tag).filter(Boolean);
  return (
    <li className="flex flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
      {photo ? (
        <AuthedPhoto path={photo} alt={row.itemName} className="aspect-square w-full rounded-none" fill onClick={onOpen} />
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${row.itemName}`}
          className="flex aspect-square w-full items-center justify-center bg-slate-50 text-slate-300 hover:bg-slate-100"
          title="No photo"
        >
          <Package aria-hidden className="size-10" />
        </button>
      )}
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        <div className="truncate text-sm font-medium text-slate-900" title={row.itemName}>
          {row.itemName}
        </div>
        <div className="tabular text-xs text-slate-600">
          {formatQuantity(row.quantity)} {row.unitName}
          {row.documentDate && <> · {formatDate(row.documentDate)}</>}
        </div>
        {row.siteName && <div className="truncate text-xs text-slate-500">{row.siteName}</div>}
        {tags.length > 0 && (
          <div className="truncate text-xs text-slate-500" title={tags.join(", ")}>
            Tags: {tags.join(", ")}
          </div>
        )}
        {row.pieces.length > 0 && (
          <button type="button" onClick={onOpen} className="self-start text-xs font-medium text-brand-700 hover:underline">
            {row.pieces.length} {row.pieces.length === 1 ? "piece" : "pieces"}
            {row.pieces.some((piece) => piece.out) && ` · ${row.pieces.filter((piece) => piece.out).length} issued`}
          </button>
        )}
        <div className="mt-auto flex items-center justify-between gap-1 pt-1.5">
          <Badge dot tone={row.isApproved ? "success" : "warning"}>
            {row.isApproved ? "Approved" : "Awaiting"}
          </Badge>
          {onEdit && (
            <Button variant="ghost" size="sm" icon={Pencil} aria-label={`Edit ${row.itemName}`} title="Edit" onClick={onEdit} />
          )}
        </div>
        {issue && <div className="pt-1.5 [&>button]:w-full">{issue}</div>}
      </div>
    </li>
  );
}
