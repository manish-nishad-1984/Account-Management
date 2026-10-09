import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CLIENT_SORT_FIELDS, type ClientRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import type { ExportColumn } from "../../lib/grid-export";
import { Button, ConfirmDialog, PageHeader } from "../../components/ui";
import { useClientList, useDeleteClient } from "./api";
import { ClientFormDialog } from "./ClientFormDialog";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";

const Absent = () => <span className="text-slate-300">—</span>;

/** What the sheet holds, column for column — the screen's own columns, as text. */
const EXPORT_COLUMNS: ExportColumn<ClientRow>[] = [
  { header: "Client", width: 34, value: (row) => row.name },
  { header: "Mobile", width: 14, value: (row) => row.mobile },
  { header: "Email", width: 30, value: (row) => row.email },
  { header: "GST number", width: 18, value: (row) => row.gstNo },
  { header: "PAN", width: 14, value: (row) => row.panNo },
  { header: "Projects", width: 40, value: (row) => row.siteNames.join(", ") },
];

/** The Client Master (9 Oct 2026): who pays us for a project. */
export function ClientsPage() {
  const canAdd = usePermission("client", "add");
  const screen = useMasterScreen<ClientRow>({ defaultSortBy: "name" });
  const query = useClientList(screen.listParams);
  const remove = useDeleteClient();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<ClientRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Client",
        cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span>,
      },
      {
        id: "mobile",
        header: "Mobile",
        cell: ({ row }) =>
          row.original.mobile ? <span className="tabular text-slate-600">{row.original.mobile}</span> : <Absent />,
      },
      {
        id: "gstNo",
        header: "GST number",
        cell: ({ row }) =>
          row.original.gstNo ? <span className="tabular text-slate-600">{row.original.gstNo}</span> : <Absent />,
      },
      {
        id: "sites",
        header: "Projects",
        cell: ({ row }) =>
          row.original.siteNames.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.original.siteNames.map((name) => (
                <span key={name} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-amber-700">No project linked</span>
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
      <PageHeader title="Clients" description="Who pays us for a project, and the projects each one pays for" />

      <DataGrid<ClientRow>
        actions={
          <>
            <ExportExcelButton<ClientRow>
              resource="clients"
              params={screen.listParams}
              columns={EXPORT_COLUMNS}
              sheetName="Clients"
              fileName="Clients"
            />
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                Add client
              </Button>
            )}
          </>
        }
        gridKey="clients"
        columns={columns}
        searchPlaceholder="Search name, mobile, GST or PAN"
        sortableFields={CLIENT_SORT_FIELDS}
        emptyMessage="No clients match this search"
        {...screen.gridProps(query)}
      />

      <ClientFormDialog open={screen.isFormOpen} clientId={screen.editingId} onClose={screen.closeForm} />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete client"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              The client is hidden from every list. A client that income has been recorded against cannot be deleted.
            </p>
          </>
        }
      />
    </>
  );
}
