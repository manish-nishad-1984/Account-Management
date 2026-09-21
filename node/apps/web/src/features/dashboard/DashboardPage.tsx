import { useId, useState } from "react";
import clsx from "clsx";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  MAX_PAGE_SIZE,
  type InwardChallanRow,
  type ItemRow,
  type ListResponse,
  type PurchaseInvoiceRow,
  type PurchaseOrderRow,
  type PurchaseRequestRow,
  type SupplierRow,
} from "@accountmanagement/contracts";
import { PageHeader } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { usePurchaseRequestList } from "../purchase-requests/api";
import { usePurchaseOrderList } from "../purchase-orders/api";
import { usePurchaseInvoiceList } from "../purchase-invoices/api";
import { useInwardChallanList } from "../inward-challans/api";
import { useItemList } from "../items/api";
import { useSupplierList } from "../suppliers/api";
import { ApprovalQueue, type QueueColumn, type QueueRow } from "./ApprovalQueue";
import { formatMoney } from "../../lib/format";

/**
 * The approval cockpit — `/Home/Index` in the source.
 *
 * Six pending-approval queues, each with a select-all in its Approve column
 * header and one bulk action. ALL SIX ARE HERE.
 *
 * COUNTS FIRST (client request, 18 Sep 2026): the screen opens on six tiles,
 * each a queue's name and how many are waiting, on a light colour of its own.
 * Clicking one opens that queue in full underneath — every pending row, not the
 * first five, with the select-all and the bulk approve as before — and clicking
 * it again closes it. Six panels of five rows each was a screen of tables to
 * read before knowing where the work was; the tiles answer that at a glance.
 *
 * A tile asks for one row: it wants the TOTAL, which every list response
 * carries. The open queue asks for up to the API's ceiling, 200; past that it
 * says how many there are and "View all" goes to the module's own list.
 *
 * The queues read the SAME hooks the list screens use, deliberately. A
 * dashboard with its own idea of what "pending" means drifts from the screen it
 * links to, and then the two disagree about a number somebody is acting on.
 *
 * THE "YOUR ACCESS" CARD IS GONE (client request, 16 Sep 2026). It listed every
 * one of the signed-in user's permissions as a badge, underneath the queues this
 * screen exists for. Who may do what is answered on Users and Permissions.
 */

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

const PENDING = { isApproved: false };
const COUNT_ONLY = { limit: 1 } as const;
const IN_FULL = { limit: MAX_PAGE_SIZE } as const;
/*
  Newest first for documents — createdAt, because documentDate is nullable and
  cannot be a keyset column — and by name for the masters. Pending means
  unapproved, whatever the active flag says.
*/
const NEWEST = { sortBy: "createdAt", sortDir: "desc" } as const;
const BY_NAME = { sortBy: "name", sortDir: "asc" } as const;

type Tone = "sky" | "violet" | "amber" | "emerald" | "indigo" | "rose";

/** Whole class names, so Tailwind finds every one of them. */
const TONES: Record<Tone, { tile: string; count: string; open: string }> = {
  sky: { tile: "bg-sky-50 ring-sky-200 hover:bg-sky-100", count: "text-sky-800", open: "ring-2 ring-sky-500" },
  violet: {
    tile: "bg-violet-50 ring-violet-200 hover:bg-violet-100",
    count: "text-violet-800",
    open: "ring-2 ring-violet-500",
  },
  amber: { tile: "bg-amber-50 ring-amber-200 hover:bg-amber-100", count: "text-amber-800", open: "ring-2 ring-amber-500" },
  emerald: {
    tile: "bg-emerald-50 ring-emerald-200 hover:bg-emerald-100",
    count: "text-emerald-800",
    open: "ring-2 ring-emerald-500",
  },
  indigo: {
    tile: "bg-indigo-50 ring-indigo-200 hover:bg-indigo-100",
    count: "text-indigo-800",
    open: "ring-2 ring-indigo-500",
  },
  rose: { tile: "bg-rose-50 ring-rose-200 hover:bg-rose-100", count: "text-rose-800", open: "ring-2 ring-rose-500" },
};

interface QueueDef<T extends QueueRow> {
  key: string;
  title: string;
  /** The permission subject — `item`, `supplier`, `inward-challan`. */
  subject: string;
  /** The API segment, for `POST /<resource>/approvals`. */
  resource: string;
  to: string;
  tone: Tone;
  /** Follows the header's site selector. The masters do not: there is no site on an item or a supplier. */
  siteScoped: boolean;
  columns: QueueColumn<T>[];
  useQueue: (params: { limit: number }) => UseQueryResult<ListResponse<T>>;
}

/** Each queue is typed by its own row; the page only ever hands a row back to its own columns. */
const define = <T extends QueueRow>(queue: QueueDef<T>) => queue as unknown as QueueDef<QueueRow>;

const QUEUES: QueueDef<QueueRow>[] = [
  define<PurchaseRequestRow>({
    key: "purchase-requests",
    title: "Purchase Requests",
    subject: "purchase-request",
    resource: "purchase-requests",
    to: "/purchase-requests",
    tone: "sky",
    siteScoped: true,
    columns: PURCHASE_REQUEST_COLUMNS,
    useQueue: (params) => usePurchaseRequestList({ ...params, ...NEWEST }, PENDING),
  }),
  define<ItemRow>({
    key: "items",
    title: "Items",
    subject: "item",
    resource: "items",
    to: "/items",
    tone: "violet",
    siteScoped: false,
    columns: ITEM_COLUMNS,
    useQueue: (params) => useItemList({ ...params, ...BY_NAME }, PENDING),
  }),
  define<SupplierRow>({
    key: "suppliers",
    title: "Suppliers",
    subject: "supplier",
    resource: "suppliers",
    to: "/suppliers",
    tone: "amber",
    siteScoped: false,
    columns: SUPPLIER_COLUMNS,
    useQueue: (params) => useSupplierList({ ...params, ...BY_NAME }, PENDING),
  }),
  define<InwardChallanRow>({
    key: "inward-challans",
    title: "Inward Challans",
    subject: "inward-challan",
    resource: "inward-challans",
    to: "/inward-challans",
    tone: "emerald",
    siteScoped: true,
    columns: CHALLAN_COLUMNS,
    useQueue: (params) => useInwardChallanList({ ...params, ...NEWEST }, PENDING),
  }),
  define<PurchaseOrderRow>({
    key: "purchase-orders",
    title: "Purchase Orders",
    subject: "purchase-orders",
    resource: "purchase-orders",
    to: "/purchase-orders",
    tone: "indigo",
    siteScoped: true,
    columns: PURCHASE_ORDER_COLUMNS,
    useQueue: (params) => usePurchaseOrderList({ ...params, ...NEWEST }, PENDING),
  }),
  define<PurchaseInvoiceRow>({
    key: "purchase-invoices",
    title: "Purchase Invoices",
    subject: "purchase-invoice",
    resource: "purchase-invoices",
    to: "/purchase-invoices",
    tone: "rose",
    siteScoped: true,
    columns: PURCHASE_INVOICE_COLUMNS,
    useQueue: (params) => usePurchaseInvoiceList({ ...params, ...NEWEST }, PENDING),
  }),
];

export function DashboardPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const detailId = useId();
  const current = QUEUES.find((queue) => queue.key === open);

  return (
    <>
      <PageHeader title={`Welcome back, ${user?.userName ?? ""}`} description="Everything waiting on an approval" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {QUEUES.map((queue) => (
          <CountTile
            key={queue.key}
            queue={queue}
            open={open === queue.key}
            controls={detailId}
            onToggle={() => setOpen((key) => (key === queue.key ? null : queue.key))}
          />
        ))}
      </div>

      {current && (
        <div id={detailId} className="mt-4">
          {/* Keyed, so switching queue starts a fresh one: each calls a different hook. */}
          <QueueInFull key={current.key} queue={current} />
        </div>
      )}
    </>
  );
}

/** One queue's name and how many are waiting; opens the queue underneath. */
function CountTile({
  queue,
  open,
  controls,
  onToggle,
}: {
  queue: QueueDef<QueueRow>;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const scope = useSiteScope();
  const count = queue.useQueue(COUNT_ONLY);
  const loading = count.isLoading || (queue.siteScoped && !scope.isReady);
  const tone = TONES[queue.tone];

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className={clsx(
        "flex flex-col items-start rounded-xl px-4 py-3 text-left ring-1 ring-inset transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        tone.tile,
        open && tone.open,
      )}
    >
      <span className="text-sm font-medium text-slate-700">{queue.title}</span>
      <span className={clsx("tabular mt-1 text-3xl font-semibold leading-none", tone.count)}>
        {loading ? "…" : count.isError ? "—" : (count.data?.total ?? 0)}
      </span>
      <span className="mt-1.5 text-xs text-slate-500">awaiting approval</span>
    </button>
  );
}

/** The whole queue, with its select-all and bulk approve. */
function QueueInFull({ queue }: { queue: QueueDef<QueueRow> }) {
  const scope = useSiteScope();
  const query = queue.useQueue(IN_FULL);
  return (
    <ApprovalQueue
      title={queue.title}
      subject={queue.subject}
      resource={queue.resource}
      to={queue.to}
      query={query}
      ready={queue.siteScoped ? scope.isReady : true}
      columns={queue.columns}
    />
  );
}
