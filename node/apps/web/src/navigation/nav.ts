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
  Boxes,
  Building2,
  ClipboardList,
  FileInput,
  FileText,
  LayoutDashboard,
  MapPin,
  Layers,
  Package,
  Receipt,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
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
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", to: "/", icon: LayoutDashboard, permission: "dashboard", status: "ready", legacy: "/Home/Index" },
    ],
  },
  {
    title: "Masters",
    items: [
      { label: "Companies", to: "/companies", icon: Building2, permission: "company", status: "ready", legacy: "/Company/CreateCompany" },
      { label: "Sites", to: "/sites", icon: MapPin, permission: "site", status: "ready", legacy: "/SiteMaster/SiteListView" },
      { label: "Site Groups", to: "/site-groups", icon: Layers, permission: "group", status: "ready", legacy: "/SiteMaster/CreateGroup" },
      { label: "Suppliers", to: "/suppliers", icon: Truck, permission: "supplier", status: "ready", legacy: "/Supplier/SupplierList" },
      { label: "Items", to: "/items", icon: Package, permission: "item", status: "ready", legacy: "/ItemMaster/ItemListView" },
      { label: "Users", to: "/users", icon: Users, permission: "user", status: "ready", legacy: "/User/UserListView" },
      { label: "Permissions", to: "/permissions", icon: ShieldCheck, permission: "user", status: "ready", legacy: "/User/UserwisePermission" },
    ],
  },
  {
    title: "Procurement",
    items: [
      { label: "Purchase Requests", to: "/purchase-requests", icon: ClipboardList, permission: "purchase-request", status: "ready", legacy: "/PurchaseMaster/PurchaseRequestListView" },
      { label: "Purchase Orders", to: "/purchase-orders", icon: ShoppingCart, permission: "purchase-orders", status: "ready", legacy: "/PurchaseMaster/POListView" },
      { label: "Inward Challans", to: "/inward", icon: FileInput, permission: "inward-challan", status: "ready", legacy: "/ItemInWord/ItemInWord" },
      { label: "Inventory", to: "/inventory", icon: Boxes, permission: "inventory-inward", status: "ready", legacy: "/Sales/CreateInventory" },
    ],
  },
  {
    title: "Invoicing",
    items: [
      { label: "Purchase Invoices", to: "/purchase-invoices", icon: Receipt, permission: "purchase-invoice", status: "ready", legacy: "/InvoiceMaster/SupplierInvoiceListView" },
      { label: "Sales Invoices", to: "/sales-invoices", icon: FileText, permission: "sales-invoice", status: "ready", legacy: "/Sales/SalesList" },
      { label: "Payments", to: "/payments", icon: Wallet, permission: "reports-payments", status: "ready", legacy: "/Report/ReportDetails (Payment Actions)" },
    ],
  },
  {
    title: "Reports",
    items: [
      { label: "Sales Report", to: "/reports/sales", icon: ScrollText, permission: "sales-report", status: "ready", legacy: "/Sales/SalesReport" },
      { label: "Ledger & Balances", to: "/reports/ledger", icon: ScrollText, permission: "details-report", status: "ready", legacy: "/Report/ReportDetails" },
    ],
  },
];

export const findNavItem = (pathname: string): NavItem | undefined =>
  NAV.flatMap((section) => section.items).find((item) => item.to === pathname);
