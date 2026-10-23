import type { DateBasis, GridWorkbookSheet, ItemRow } from "@accountmanagement/contracts";
import { exportAmount, exportYesNo, fetchAllRows, workbookSheet, type ExportColumn } from "../../lib/grid-export";
import type { ListFilters } from "../../lib/list-query";
import { EXPORT_COLUMNS as AGENCY_COLUMNS } from "../agencies/AgenciesPage";
import { EXPORT_COLUMNS as INCOME_COLUMNS } from "../client-incomes/ClientIncomesPage";
import { EXPORT_COLUMNS as CLIENT_COLUMNS } from "../clients/ClientsPage";
import { EXPORT_COLUMNS as EMPLOYEE_COLUMNS } from "../employees/EmployeesPage";
import { EXPORT_COLUMNS as COMPANY_COLUMNS } from "../companies/CompaniesPage";
import { EXPORT_COLUMNS as INVENTORY_COLUMNS } from "../inventory/InventoryPage";
import { EXPORT_COLUMNS as CHALLAN_COLUMNS } from "../inward-challans/InwardChallansPage";
import { EXPORT_COLUMNS as PAYMENT_COLUMNS } from "../payments/PaymentsPage";
import { EXPORT_COLUMNS as PAYOUT_COLUMNS } from "../payouts/PayoutListsPage";
import { WITH_DETAILS_COLUMNS as PAYOUT_DETAIL_COLUMNS, fetchPayoutDetailRows } from "../payouts/PayoutExportButton";
import { EXPORT_COLUMNS as PURCHASE_INVOICE_COLUMNS } from "../purchase-invoices/PurchaseInvoicesPage";
import { WITH_ITEMS_COLUMNS, fetchInvoiceLineRows, oldestFirst } from "../purchase-invoices/InvoiceExportButton";
import { EXPORT_COLUMNS as ORDER_COLUMNS } from "../purchase-orders/PurchaseOrdersPage";
import { EXPORT_COLUMNS as REQUEST_COLUMNS } from "../purchase-requests/PurchaseRequestsPage";
import { EXPORT_COLUMNS as SALES_COLUMNS } from "../sales-invoices/SalesInvoicesPage";
import { EXPORT_COLUMNS as LOCATION_COLUMNS } from "../site-locations/SiteLocationsPage";
import { EXPORT_COLUMNS as SITE_COLUMNS } from "../sites/SitesPage";
import { EXPORT_COLUMNS as SUPPLIER_COLUMNS } from "../suppliers/SuppliersPage";

/**
 * WHAT THE EXCEL EXPORT CENTRE CAN PUT IN A FILE (client, 20 Oct 2026: "one
 * place to export every module, tick what you want").
 *
 * Each entry is a list screen's own export — the same rows the screen's "Export
 * to Excel" gives, with the same columns — so the two can never disagree about
 * what a purchase invoice sheet holds. What this adds is the date range, and
 * which of a record's dates it counts by, as the balance sheet asks.
 */

export const EXPORT_GROUPS = ["Masters", "Procurement", "Invoices & payments"] as const;
export type ExportGroup = (typeof EXPORT_GROUPS)[number];

/** What the person chose at the top of the screen, applied to each sheet where it fits. */
export interface ExportChoices {
  fromDate: string;
  toDate: string;
  dateBasis: DateBasis;
  companyId: string;
  siteId: string;
}

export interface ExportDataset {
  key: string;
  group: ExportGroup;
  label: string;
  /** One line under the name, so nobody has to open the sheet to know what it is. */
  hint: string;
  /** The screen's view right; a sheet the person cannot see on screen is not offered. */
  permission: string;
  /** The record's own date as people call it. Absent: a master, exported whole. */
  dateLabel?: string;
  /** The list takes these filters. */
  bySite?: boolean;
  byCompany?: boolean;
  sheet: (choices: ExportChoices) => Promise<GridWorkbookSheet>;
}

/** The list's filters for one dataset: only those it understands. */
export function filtersFor(dataset: Pick<ExportDataset, "dateLabel" | "bySite" | "byCompany">, choices: ExportChoices): ListFilters {
  const filters: ListFilters = {};
  if (dataset.dateLabel) {
    if (choices.fromDate) filters.fromDate = choices.fromDate;
    if (choices.toDate) filters.toDate = choices.toDate;
    if (choices.fromDate || choices.toDate) filters.dateBasis = choices.dateBasis;
  }
  if (dataset.bySite && choices.siteId) filters.siteId = choices.siteId;
  if (dataset.byCompany && choices.companyId) filters.companyId = choices.companyId;
  return filters;
}

/** The item master as a sheet; its own screen exports the re-importable price list instead. */
export const ITEM_COLUMNS: ExportColumn<ItemRow>[] = [
  { header: "Item", width: 40, value: (row) => row.name },
  { header: "Unit", width: 10, value: (row) => row.unitName },
  { header: "Price per unit", width: 14, align: "right", value: (row) => exportAmount(row.pricePerUnit) },
  { header: "GST %", width: 8, align: "right", value: (row) => exportAmount(row.gstPercent) },
  { header: "GST amount", width: 12, align: "right", value: (row) => exportAmount(row.gstAmount) },
  { header: "HSN code", width: 12, value: (row) => row.hsnCode },
  { header: "Approved", width: 10, value: (row) => exportYesNo(row.isApproved) },
];

function listDataset<T>(
  spec: Omit<ExportDataset, "sheet"> & { resource: string; columns: ExportColumn<T>[]; sheetName: string; order?: (rows: T[]) => T[] },
): ExportDataset {
  const { resource, columns, sheetName, order = (rows) => rows, ...dataset } = spec;
  return {
    ...dataset,
    sheet: async (choices) => workbookSheet(order(await fetchAllRows<T>(resource, {}, filtersFor(dataset, choices))), columns, sheetName),
  };
}

export const EXPORT_DATASETS: ExportDataset[] = [
  // Masters: every record, whatever the dates.
  listDataset({ key: "items", group: "Masters", label: "Items", hint: "Name, unit, price, GST, HSN", permission: "item", resource: "items", columns: ITEM_COLUMNS, sheetName: "Items" }),
  listDataset({ key: "suppliers", group: "Masters", label: "Suppliers", hint: "Parties with GST and contact details", permission: "supplier", resource: "suppliers", columns: SUPPLIER_COLUMNS, sheetName: "Suppliers" }),
  listDataset({ key: "sites", group: "Masters", label: "Sites", hint: "Projects and their addresses", permission: "site", resource: "sites", columns: SITE_COLUMNS, sheetName: "Sites" }),
  listDataset({ key: "site-locations", group: "Masters", label: "Site locations", hint: "Locations under each site", permission: "group", resource: "site-locations", columns: LOCATION_COLUMNS, sheetName: "Site locations" }),
  listDataset({ key: "companies", group: "Masters", label: "Companies", hint: "Your companies, GST and bank", permission: "company", resource: "companies", columns: COMPANY_COLUMNS, sheetName: "Companies" }),
  listDataset({ key: "clients", group: "Masters", label: "Clients", hint: "Who the income comes from", permission: "client", resource: "clients", columns: CLIENT_COLUMNS, sheetName: "Clients" }),
  listDataset({ key: "employees", group: "Masters", label: "Employees", hint: "Payroll: company, site, basic and net salary", permission: "employee", byCompany: true, resource: "employees", columns: EMPLOYEE_COLUMNS, sheetName: "Employees" }),
  listDataset({ key: "agencies", group: "Masters", label: "Agencies", hint: "Agency master", permission: "agency", resource: "agencies", columns: AGENCY_COLUMNS, sheetName: "Agencies" }),

  // Procurement.
  listDataset({ key: "purchase-requests", group: "Procurement", label: "Purchase requests", hint: "One row per request", permission: "purchase-request", dateLabel: "Request date", bySite: true, resource: "purchase-requests", columns: REQUEST_COLUMNS, sheetName: "Purchase requests" }),
  listDataset({ key: "purchase-orders", group: "Procurement", label: "Purchase orders", hint: "One row per PO, with its total", permission: "purchase-orders", dateLabel: "PO date", bySite: true, resource: "purchase-orders", columns: ORDER_COLUMNS, sheetName: "Purchase orders" }),
  listDataset({ key: "inward-challans", group: "Procurement", label: "Inward challans", hint: "Material received at site", permission: "inward-challan", dateLabel: "Challan date", bySite: true, resource: "inward-challans", columns: CHALLAN_COLUMNS, sheetName: "Inward challans" }),
  listDataset({ key: "inventory", group: "Procurement", label: "Inventory", hint: "Inventory inward entries", permission: "inventory-inward", dateLabel: "Inward date", bySite: true, resource: "inventory-inward", columns: INVENTORY_COLUMNS, sheetName: "Inventory" }),

  // Invoices and money.
  listDataset({ key: "purchase-invoices", group: "Invoices & payments", label: "Purchase invoices", hint: "One row per bill, with paid / pending", permission: "purchase-invoice", dateLabel: "Bill date", bySite: true, byCompany: true, resource: "purchase-invoices", columns: PURCHASE_INVOICE_COLUMNS, sheetName: "Purchase invoices", order: oldestFirst }),
  {
    key: "purchase-invoice-items",
    group: "Invoices & payments",
    label: "Purchase invoice items",
    hint: "One row per item of each bill: qty, rate, GST",
    permission: "purchase-invoice",
    dateLabel: "Bill date",
    bySite: true,
    byCompany: true,
    sheet: async (choices) =>
      workbookSheet(
        await fetchInvoiceLineRows({}, filtersFor({ dateLabel: "Bill date", bySite: true, byCompany: true }, choices)),
        WITH_ITEMS_COLUMNS,
        "Purchase invoice items",
      ),
  },
  listDataset({ key: "sales-invoices", group: "Invoices & payments", label: "Sales invoices", hint: "One row per sales invoice", permission: "sales-invoice", dateLabel: "Invoice date", bySite: true, byCompany: true, resource: "sales-invoices", columns: SALES_COLUMNS, sheetName: "Sales invoices" }),
  listDataset({ key: "income", group: "Invoices & payments", label: "Income", hint: "Client income with additions and deductions", permission: "income", dateLabel: "Income date", bySite: true, byCompany: true, resource: "client-incomes", columns: INCOME_COLUMNS, sheetName: "Income" }),
  listDataset({ key: "payments", group: "Invoices & payments", label: "Payments", hint: "Payments, receipts and opening balances", permission: "reports-payments", dateLabel: "Payment date", bySite: true, byCompany: true, resource: "payments", columns: PAYMENT_COLUMNS, sheetName: "Payments" }),
  listDataset({ key: "payout-lists", group: "Invoices & payments", label: "Payout lists", hint: "Saved payout lists and their totals", permission: "payout", dateLabel: "List date", byCompany: true, resource: "payout-lists", columns: PAYOUT_COLUMNS, sheetName: "Payout lists" }),
  {
    key: "payout-list-details",
    group: "Invoices & payments",
    label: "Payout list details",
    hint: "Every party and bill of each payout list",
    permission: "payout",
    dateLabel: "List date",
    byCompany: true,
    sheet: async (choices) =>
      workbookSheet(
        await fetchPayoutDetailRows({}, filtersFor({ dateLabel: "List date", byCompany: true }, choices)),
        PAYOUT_DETAIL_COLUMNS,
        "Payout list details",
      ),
  },
];

/** One-click sets, so the common exports need no thinking. */
export const EXPORT_PACKS: { label: string; keys: string[] }[] = [
  { label: "Purchase pack", keys: ["purchase-orders", "inward-challans", "purchase-invoices", "purchase-invoice-items", "suppliers", "items"] },
  { label: "Accounts pack", keys: ["purchase-invoices", "payments", "income", "sales-invoices", "payout-lists"] },
  { label: "All masters", keys: ["items", "suppliers", "sites", "site-locations", "companies", "clients", "agencies"] },
];
