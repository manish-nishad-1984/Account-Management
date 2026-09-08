import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ITEM_SORT_FIELDS, type ItemRow } from "@accountmanagement/contracts";
import { AlertTriangle, Download, Plus, Ruler, Upload } from "lucide-react";
import { DataGrid, RowActions } from "../../components/DataGrid";
import { Alert, Badge, Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { downloadItemSheet, useDeleteItem, useItemList } from "./api";
import { ApiError } from "../../lib/api-client";
import { ItemFormDialog } from "./ItemFormDialog";
import { ItemImportDialog } from "./ItemImportDialog";
import { UnitsDialog } from "./UnitsDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { formatMoney, formatPercent } from "../../lib/format";

const Absent = () => <span className="text-slate-300">—</span>;

export function ItemsPage() {
  const canAdd = usePermission("item", "add");
  const canView = usePermission("item", "view");
  const screen = useMasterScreen<ItemRow>({ defaultSortBy: "name" });
  const query = useItemList(screen.listParams);
  const remove = useDeleteItem();
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { openEdit, askDelete } = screen;

  /**
   * The download is a plain async handler, not a mutation.
   *
   * It writes nothing, so a `useMutation` would be borrowing the wrong tool
   * for its pending flag — and TanStack Query would cache a Blob keyed by
   * nothing useful. What it does need is its own error state: the failure
   * cannot go through the grid's, which belongs to the list query.
   */
  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadItemSheet(screen.listParams.search);
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.message : "The download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const columns = useMemo<ColumnDef<ItemRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Item",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.name}</div>
            <div className="tabular text-xs text-slate-500">
              {row.original.hsnCode ? `HSN ${row.original.hsnCode}` : "No HSN code"}
            </div>
          </div>
        ),
      },
      {
        id: "unitName",
        header: "Unit",
        cell: ({ row }) => <span className="text-slate-600">{row.original.unitName}</span>,
      },
      {
        id: "pricePerUnit",
        header: "Price / unit",
        cell: ({ row }) => (
          <span className="tabular block text-right text-slate-800">
            {formatMoney(row.original.pricePerUnit)}
          </span>
        ),
      },
      {
        id: "gst",
        header: "GST",
        cell: ({ row }) =>
          row.original.isWithGst ? (
            <div className="text-right">
              <div className="tabular text-slate-700">
                {row.original.gstPercent ? formatPercent(row.original.gstPercent) : <Absent />}
              </div>
              {row.original.gstAmount && (
                <div className="tabular text-xs text-slate-500">
                  {formatMoney(row.original.gstAmount)}
                </div>
              )}
            </div>
          ) : (
            <span className="block text-right text-xs text-slate-500">Not GST</span>
          ),
      },
      {
        id: "isApproved",
        header: "Approved",
        cell: ({ row }) => (
          <Badge
            dot
            tone={row.original.isApproved ? "success" : "warning"}
            title="Recorded on the item. It does not prevent use on a purchase order."
          >
            {row.original.isApproved ? "Approved" : "Not approved"}
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

  return (
    <>
      <PageHeader
        title="Items"
        description="Materials and services that appear on purchase orders"
        actions={
          <>
            {/*
              Units are reachable from here rather than from the sidebar: there
              is no `unit` permission anywhere in the source, and nobody visits
              units except while defining an item.
            */}
            {canView && (
              <Button variant="secondary" icon={Ruler} onClick={() => setUnitsOpen(true)}>
                Units
              </Button>
            )}
            {/*
              "Download File" and "Upload File" on the legacy screen. Download
              is guarded by `item.view` and Upload by `item.add`, matching the
              list and the create form they stand in for — the legacy download
              action carries no permission attribute at all, so anyone who can
              reach the site can pull the entire price list.
            */}
            {canView && (
              <Button
                variant="secondary"
                icon={Download}
                loading={downloading}
                onClick={download}
              >
                Download File
              </Button>
            )}
            {canAdd && (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
                Upload File
              </Button>
            )}
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                Add item
              </Button>
            )}
          </>
        }
      />

      {downloadError && (
        <Alert icon={AlertTriangle} className="mb-4">
          {downloadError}
        </Alert>
      )}

      <DataGrid<ItemRow>
        columns={columns}
        searchPlaceholder="Search item name or HSN code"
        sortableFields={ITEM_SORT_FIELDS}
        emptyMessage="No items match this search"
        {...screen.gridProps(query)}
      />

      <ItemFormDialog open={screen.isFormOpen} itemId={screen.editingId} onClose={screen.closeForm} />

      <UnitsDialog open={unitsOpen} onClose={() => setUnitsOpen(false)} />

      <ItemImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete item"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The item is marked deleted and hidden from every list. Purchase
              requests and inward challans have not been migrated yet, so this
              cannot check whether any reference it.
            </p>
          </>
        }
      />
    </>
  );
}
