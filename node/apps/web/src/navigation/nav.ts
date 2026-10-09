/**
 * Navigation mirrors the 31 screens catalogued in
 * Migration-Assessment/03-Module-Inventory.md, grouped the way the business
 * actually works: masters, then the procure-to-pay flow, then money, then reports.
 *
 * `permission` is the subject checked against the caller's rights. `status` says
 * whether the screen has been migrated yet — shown honestly in the UI rather than
 * linking to a page that does not exist.
 */

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Boxes,
  Building2,
  ClipboardList,
  Database,
  FileInput,
  FileText,
  HandCoins,
  Banknote,
  Handshake,
  HardHat,
  Hourglass,
  LayoutDashboard,
  LayoutTemplate,
  MapPin,
  Layers,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";

export type ScreenStatus = "ready" | "planned";

export interface NavItem {
  label: string;
  to: string;
  permission: string;
  status: ScreenStatus;
  icon: LucideIcon;
  /** The .NET route this replaces, so the mapping stays traceable. */
  legacy?: string;
}

export interface NavSection {
  title: string;
  /** Shown beside the heading when the rail lists sections rather than screens. */
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * The section that lives behind the gear in the top bar instead of in the rail
 * (client request: the rail carried too many entries). It stays in `NAV` so its
 * routes, its breadcrumb and its permission filter work like every other screen.
 */
export const SETTINGS_SECTION = "Settings";

export const NAV: NavSection[] = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    items: [
      { label: "Dashboard", to: "/", icon: LayoutDashboard, permission: "dashboard", status: "ready", legacy: "/Home/Index" },
    ],
  },
  {
    title: "Masters",
    icon: Database,
    items: [
      { label: "Companies", to: "/companies", icon: Building2, permission: "company", status: "ready", legacy: "/Company/CreateCompany" },
      { label: "Sites", to: "/sites", icon: MapPin, permission: "site", status: "ready", legacy: "/SiteMaster/SiteListView" },
      { label: "Site Location", to: "/site-locations", icon: Layers, permission: "group", status: "ready", legacy: "/SiteMaster/CreateGroup" },
      { label: "Suppliers", to: "/suppliers", icon: Truck, permission: "supplier", status: "ready", legacy: "/Supplier/SupplierList" },
      // New, no legacy screen: the contractors who work on a site (1 Oct 2026).
      // New, no legacy screen: who pays us for a project (9 Oct 2026).
      { label: "Clients", to: "/clients", icon: Handshake, permission: "client", status: "ready" },
      { label: "Agency Master", to: "/agencies", icon: HardHat, permission: "agency", status: "ready" },
      { label: "Items", to: "/items", icon: Package, permission: "item", status: "ready", legacy: "/ItemMaster/ItemListView" },
      { label: "Users", to: "/users", icon: Users, permission: "user", status: "ready", legacy: "/User/UserListView" },
      { label: "Permissions", to: "/permissions", icon: ShieldCheck, permission: "user", status: "ready", legacy: "/User/UserwisePermission" },
    ],
  },
  {
    title: "Procurement",
    icon: ShoppingBag,
    items: [
      { label: "Purchase Requests", to: "/purchase-requests", icon: ClipboardList, permission: "purchase-request", status: "ready", legacy: "/PurchaseMaster/PurchaseRequestListView" },
      { label: "Purchase Orders", to: "/purchase-orders", icon: ShoppingCart, permission: "purchase-orders", status: "ready", legacy: "/PurchaseMaster/POListView" },
      { label: "Inward Challans", to: "/inward", icon: FileInput, permission: "inward-challan", status: "ready", legacy: "/ItemInWord/ItemInWord" },
      { label: "Inventory", to: "/inventory", icon: Boxes, permission: "inventory-inward", status: "ready", legacy: "/Sales/CreateInventory" },
    ],
  },
  {
    title: "Invoicing",
    icon: Receipt,
    items: [
      { label: "Purchase Invoices", to: "/purchase-invoices", icon: Receipt, permission: "purchase-invoice", status: "ready", legacy: "/InvoiceMaster/SupplierInvoiceListView" },
      { label: "Sales Invoices", to: "/sales-invoices", icon: FileText, permission: "sales-invoice", status: "ready", legacy: "/Sales/SalesList" },
      // New, no legacy screen: money the project's client has paid us (9 Oct 2026).
      { label: "Income", to: "/income", icon: Banknote, permission: "income", status: "ready" },
      { label: "Payments", to: "/payments", icon: Wallet, permission: "reports-payments", status: "ready", legacy: "/Report/ReportDetails (Payment Actions)" },
    ],
  },
  {
    // New, no legacy screen: the owner's "I can pay out 40 lakh today" lists (5 Oct 2026).
    // A section of one, so the rail names it after the screen ("Payout List"): short
    // enough for 88px at 11px type, which "Payout Lists" is not guaranteed to be.
    title: "Payout",
    icon: HandCoins,
    items: [
      { label: "Payout List", to: "/payouts", icon: HandCoins, permission: "payout", status: "ready" },
    ],
  },
  {
    title: "Reports",
    icon: ScrollText,
    items: [
      // Both panels of ONE legacy screen, and both guarded by the subject that
      // screen actually asks for. `sales-report` and `details-report` are dead
      // rows in the Form table, checked nowhere in the .NET solution and inactive
      // in production, so naming them here hid the report from everyone.
      { label: "Sales Report", to: "/reports/sales", icon: TrendingUp, permission: "reports-payments", status: "ready", legacy: "/Sales/SalesReport" },
      { label: "Ledger", to: "/reports/ledger", icon: BookOpen, permission: "reports-payments", status: "ready", legacy: "/InvoiceMaster/PayOutInvoice" },
      // Began as the "Pending Ledger", a copy of the ledger for the client to try out (14 Sep 2026).
      // Since 1 Oct 2026 it is only the outstanding summary: site, supplier and net.
      { label: "Pending Outstanding", to: "/reports/pending-ledger", icon: Hourglass, permission: "reports-payments", status: "ready" },
    ],
  },
  {
    title: SETTINGS_SECTION,
    icon: Settings,
    items: [
      // New, with no legacy screen: the old app has one fixed print page per
      // invoice (client request, 14 Sep 2026).
      { label: "Document Layouts", to: "/settings/document-layouts", icon: LayoutTemplate, permission: "document-template", status: "ready" },
    ],
  },
];

export const findNavItem = (pathname: string): NavItem | undefined =>
  NAV.flatMap((section) => section.items).find((item) => item.to === pathname);
