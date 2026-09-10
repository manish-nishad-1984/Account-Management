import { Link } from "react-router-dom";
import {
  APPROVAL_QUEUE_SIZE,
  type InwardChallanRow,
  type ItemRow,
  type PurchaseInvoiceRow,
  type PurchaseOrderRow,
  type PurchaseRequestRow,
  type SupplierRow,
} from "@accountmanagement/contracts";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Badge, Card, CardHeader, PageHeader } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { usePurchaseRequestList } from "../purchase-requests/api";
import { usePurchaseOrderList } from "../purchase-orders/api";
import { usePurchaseInvoiceList } from "../purchase-invoices/api";
import { useInwardChallanList } from "../inward-challans/api";
import { useItemList } from "../items/api";
import { useSupplierList } from "../suppliers/api";
import { ApprovalQueue, type QueueColumn } from "./ApprovalQueue";
import { formatMoney } from "../../lib/format";

/**
 * The approval cockpit — `/Home/Index` in the source.
 *
 * Six pending-approval queues, each with a select-all in its Approve column
 * header and one bulk action. ALL SIX ARE HERE.
 *
 * Purchase Orders joined on 8 Sep 2026 when that module landed, and Purchase
 * Invoices on the same day when theirs did — the last of the two that had stood
 * as a `NotMigrated` panel naming the table it could not read. That component is
 * gone with them; a dashboard that looks populated and is not is worse than one
 * that admits what it cannot see (convention 2), but there is nothing left to
 * admit here, and keeping the apology around would be its own kind of stale.
 *
 * The queues read the SAME hooks the list screens use, deliberately. A
 * dashboard with its own idea of what "pending" means drifts from the screen it
 * links to, and then the two disagree about a number somebody is acting on.
 */
const QUEUE_PARAMS = { limit: APPROVAL_QUEUE_SIZE } as const;
const PENDING = { isApproved: false };

export function DashboardPage() {
  const { user } = useAuth();
  const scope = useSiteScope();

  // The two site-scoped queues follow the header's selector, as the legacy
  // panels do — which is why their empty state talks about criteria.
  const requests = usePurchaseRequestList(
    { ...QUEUE_PARAMS, sortBy: "createdAt", sortDir: "desc" },
    PENDING,
  );
  const challans = useInwardChallanList(
    { ...QUEUE_PARAMS, sortBy: "createdAt", sortDir: "desc" },
    PENDING,
  );
  // Site-scoped like the two above. Pending means unapproved, whatever the
  // active flag says — an inactive order awaiting approval is still awaiting it.
  const orders = usePurchaseOrderList(
    { ...QUEUE_PARAMS, sortBy: "createdAt", sortDir: "desc" },
    PENDING,
  );
  // The SIXTH queue, and the last of the two §5p had to leave as "not migrated".
  // Sorted on createdAt because documentDate is nullable and cannot be a keyset
  // column — see the purchase invoice contract.
  const invoices = usePurchaseInvoiceList(
    { ...QUEUE_PARAMS, sortBy: "createdAt", sortDir: "desc" },
    PENDING,
  );

  // Masters are not site-scoped: there is no site on an item or a supplier.
  const items = useItemList({ ...QUEUE_PARAMS, sortBy: "name", sortDir: "asc" }, PENDING);
  const suppliers = useSupplierList({ ...QUEUE_PARAMS, sortBy: "name", sortDir: "asc" }, PENDING);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.userName ?? ""}`}
        description="Everything waiting on an approval"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ApprovalQueue<PurchaseRequestRow>
          title="Purchase Requests"
          subject="purchase-request"
          resource="purchase-requests"
          to="/purchase-requests"
          query={requests}
          ready={scope.isReady}
          columns={PURCHASE_REQUEST_COLUMNS}
        />

        <ApprovalQueue<ItemRow>
          title="Items"
          subject="item"
          resource="items"
          to="/items"
          query={items}
          columns={ITEM_COLUMNS}
        />

        <ApprovalQueue<SupplierRow>
          title="Suppliers"
          subject="supplier"
          resource="suppliers"
          to="/suppliers"
          query={suppliers}
          columns={SUPPLIER_COLUMNS}
        />

        <ApprovalQueue<InwardChallanRow>
          title="Inward Challans"
          subject="inward-challan"
          resource="inward-challans"
          to="/inward-challans"
          query={challans}
          ready={scope.isReady}
          columns={CHALLAN_COLUMNS}
        />

        <ApprovalQueue<PurchaseOrderRow>
          title="Purchase Orders"
          subject="purchase-orders"
          resource="purchase-orders"
          to="/purchase-orders"
          query={orders}
          ready={scope.isReady}
          columns={PURCHASE_ORDER_COLUMNS}
        />

        <ApprovalQueue<PurchaseInvoiceRow>
          title="Purchase Invoices"
          subject="purchase-invoice"
          resource="purchase-invoices"
          to="/purchase-invoices"
          query={invoices}
          ready={scope.isReady}
          columns={PURCHASE_INVOICE_COLUMNS}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Your access" description="Granted rights on this account" />

        {user && user.permissions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {user.permissions.map((permission) => (
              <Badge key={permission} tone="info">
                {permission}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No permissions granted.</p>
        )}

        <div className="mt-5 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-100">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-emerald-600" />
          <p className="text-xs leading-relaxed text-emerald-800">
            Every one of these is re-checked on the server. Hiding a button is a
            convenience, never the control — the Approve boxes above are no exception.
          </p>
        </div>

        {/* Same reasoning as "View all" on the approval queue. */}
        <Link
          to="/users"
          className="-mb-2 mt-5 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-brand-600 transition-colors hover:text-brand-700 lg:mb-0 lg:py-0"
        >
          Manage users
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>
    </>
  );
}

const Absent = () => <span className="text-slate-300">—</span>;

const PURCHASE_REQUEST_COLUMNS: QueueColumn<PurchaseRequestRow>[] = [
  { key: "prNo", header: "PR No", cell: (row) => row.prNo },
  { key: "siteName", header: "Site", cell: (row) => row.siteName ?? <Absent /> },
  // `itemLabel`, not the item's name: a request raised with free text and no
  // `itemId` is invisible in the source, which INNER JOINs `ItemMaster`. Here it
  // lists, labelled by what was typed (§5f).
  { key: "itemLabel", header: "Item", cell: (row) => row.itemLabel },
  { key: "quantity", header: "Qty", numeric: true, cell: (row) => row.quantity },
];

const PURCHASE_ORDER_COLUMNS: QueueColumn<PurchaseOrderRow>[] = [
  { key: "poNo", header: "PO No", cell: (row) => row.poNo },
  { key: "supplierName", header: "Supplier", cell: (row) => row.supplierName ?? <Absent /> },
  { key: "siteName", header: "Site", cell: (row) => row.siteName ?? <Absent /> },
  {
    key: "totalAmount",
    header: "Total",
    numeric: true,
    cell: (row) => formatMoney(row.totalAmount),
  },
];

/**
 * The invoice queue shows `displayNo`, not `supplierInvoiceNo`.
 *
 * The number on a purchase invoice is the SUPPLIER'S and may be absent, in which
 * case the legacy list renders a blank, unclickable cell. `displayNo` falls back
 * to our own number and then to a placeholder, so a row in an approval queue can
 * always be identified — which matters more here than anywhere, since the whole
 * point of the panel is to decide about a specific document.
 */
const PURCHASE_INVOICE_COLUMNS: QueueColumn<PurchaseInvoiceRow>[] = [
  { key: "displayNo", header: "Invoice", cell: (row) => row.displayNo },
  { key: "supplierName", header: "Supplier", cell: (row) => row.supplierName ?? <Absent /> },
  { key: "siteName", header: "Site", cell: (row) => row.siteName ?? <Absent /> },
  {
    key: "totalAmount",
    header: "Total",
    numeric: true,
    cell: (row) => formatMoney(row.totalAmount),
  },
];

const ITEM_COLUMNS: QueueColumn<ItemRow>[] = [
  { key: "name", header: "Item", cell: (row) => row.name },
  { key: "unitName", header: "Unit", cell: (row) => row.unitName },
  {
    key: "pricePerUnit",
    header: "Price",
    numeric: true,
    cell: (row) => formatMoney(row.pricePerUnit),
  },
];

const SUPPLIER_COLUMNS: QueueColumn<SupplierRow>[] = [
  { key: "name", header: "Supplier", cell: (row) => row.name },
  { key: "gstNo", header: "GST", cell: (row) => row.gstNo ?? <Absent /> },
];

const CHALLAN_COLUMNS: QueueColumn<InwardChallanRow>[] = [
  { key: "itemName", header: "Item", cell: (row) => row.itemName ?? <Absent /> },
  { key: "supplierName", header: "Supplier", cell: (row) => row.supplierName ?? "Not recorded" },
  { key: "quantity", header: "Qty", numeric: true, cell: (row) => row.quantity },
];
