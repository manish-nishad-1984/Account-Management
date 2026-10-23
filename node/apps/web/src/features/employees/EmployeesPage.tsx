import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { EMPLOYEE_SORT_FIELDS, type EmployeeRow } from "@accountmanagement/contracts";
import { Plus } from "lucide-react";
import { DataGrid, ExportExcelButton, RowActions } from "../../components/DataGrid";
import { exportAmount, exportDate, type ExportColumn } from "../../lib/grid-export";
import { Badge, Button, ConfirmDialog, PageHeader, SelectField } from "../../components/ui";
import { formatDate, formatMoney } from "../../lib/format";
import { usePermission } from "../../lib/permissions";
import { useMasterScreen } from "../../lib/use-master-screen";
import { useCompanyOptions } from "../purchase-orders/api";
import { useDeleteEmployee, useEmployeeList } from "./api";
import { EmployeeFormDialog } from "./EmployeeFormDialog";

const Absent = () => <span className="text-slate-300">—</span>;

/** What the sheet holds, column for column. Bank details stay out of a list export. */
export const EXPORT_COLUMNS: ExportColumn<EmployeeRow>[] = [
  { header: "Employee", width: 30, value: (row) => row.name },
  { header: "Mobile", width: 14, value: (row) => row.mobile },
  { header: "Company", width: 26, value: (row) => row.companyName },
  { header: "Site", width: 24, value: (row) => row.siteName },
  { header: "Date of joining", width: 14, value: (row) => exportDate(row.joinDate) },
  { header: "Basic salary", width: 14, align: "right", value: (row) => exportAmount(row.basicSalary) },
  { header: "Additions", width: 12, align: "right", value: (row) => exportAmount(row.additions) },
  { header: "Deductions", width: 12, align: "right", value: (row) => exportAmount(row.deductions) },
  { header: "Net salary", width: 14, align: "right", value: (row) => exportAmount(row.netSalary) },
  { header: "Status", width: 10, value: (row) => (row.isActive ? "Active" : "Inactive") },
];

const STATUS_OPTIONS = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
  { value: "", label: "All employees" },
];

/**
 * The Employee Master (client request, 23 Oct 2026): who is on the payroll and
 * what a month pays. An active employee's salary comes up on the payout list
 * each month until it is paid.
 */
export function EmployeesPage() {
  const canAdd = usePermission("employee", "add");
  const screen = useMasterScreen<EmployeeRow>({ defaultSortBy: "name" });
  const [companyId, setCompanyId] = useState("");
  const [active, setActive] = useState("true");
  const companies = useCompanyOptions();
  const filters = { companyId: companyId === "" ? undefined : companyId, active: active === "" ? undefined : active };
  const query = useEmployeeList(screen.listParams, filters);
  const remove = useDeleteEmployee();

  const { openEdit, askDelete } = screen;

  const columns = useMemo<ColumnDef<EmployeeRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span>,
      },
      {
        id: "company",
        header: "Company / Site",
        cell: ({ row }) => (
          <span className="text-slate-700">
            {row.original.companyName}
            {row.original.siteName && <span className="text-xs text-slate-500"> · {row.original.siteName}</span>}
          </span>
        ),
      },
      {
        id: "joinDate",
        header: "Joined",
        cell: ({ row }) =>
          row.original.joinDate ? <span className="tabular text-slate-600">{formatDate(row.original.joinDate)}</span> : <Absent />,
      },
      {
        id: "basic",
        header: "Basic",
        meta: { align: "right" },
        cell: ({ row }) => <span className="tabular block text-right text-slate-600">{formatMoney(row.original.basicSalary)}</span>,
      },
      {
        id: "net",
        header: "Net salary",
        meta: { align: "right" },
        cell: ({ row }) => <span className="tabular block text-right font-semibold text-slate-900">{formatMoney(row.original.netSalary)}</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (row.original.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge>Inactive</Badge>),
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
      <PageHeader title="Employees" description="Who is on the payroll, and what each month pays" />

      <DataGrid<EmployeeRow>
        filters={
          <>
            <SelectField
              labelHidden
              label="Company"
              value={companyId}
              options={[
                { value: "", label: "All companies" },
                ...(companies.data?.rows ?? []).map((row) => ({ value: row.id, label: row.name })),
              ]}
              onChange={(event) => setCompanyId(event.target.value)}
            />
            <SelectField labelHidden label="Status" value={active} options={STATUS_OPTIONS} onChange={(event) => setActive(event.target.value)} />
          </>
        }
        actions={
          <>
            <ExportExcelButton<EmployeeRow>
              resource="employees"
              params={screen.listParams}
              filters={filters}
              columns={EXPORT_COLUMNS}
              sheetName="Employees"
              fileName="Employees"
            />
            {canAdd && (
              <Button icon={Plus} onClick={screen.openCreate}>
                Add employee
              </Button>
            )}
          </>
        }
        gridKey="employees"
        columns={columns}
        searchPlaceholder="Search name or mobile"
        sortableFields={EMPLOYEE_SORT_FIELDS}
        emptyMessage="No employees match this search"
        {...screen.gridProps(query)}
      />

      <EmployeeFormDialog open={screen.isFormOpen} employeeId={screen.editingId} onClose={screen.closeForm} />

      <ConfirmDialog
        open={screen.deleteTarget !== null}
        onClose={screen.cancelDelete}
        onConfirm={() => screen.runDelete(remove.mutateAsync)}
        pending={remove.isPending}
        error={screen.deleteError}
        title="Delete employee"
        body={
          <>
            <p>
              Delete <span className="font-medium text-slate-900">{screen.deleteTarget?.name}</span>?
            </p>
            <p className="mt-2 text-xs text-slate-500">
              An employee whose salary is on a payout list or paid cannot be deleted. Mark them inactive instead.
            </p>
          </>
        }
      />
    </>
  );
}
