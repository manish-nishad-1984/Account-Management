import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { Card, PageHeader } from "./ui";
import { findNavItem } from "../navigation/nav";

/**
 * A screen that has not been migrated yet.
 *
 * Deliberately states the fact rather than showing an empty grid or invented
 * figures — this is a financial system, and a page that looks populated but is
 * not would be worse than one that says so.
 */
export function PlaceholderPage() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const Icon = item?.icon ?? Construction;

  return (
    <>
      <PageHeader
        title={item?.label ?? "Not found"}
        description="This screen has not been migrated yet"
      />

      <Card padded={false}>
        <div className="px-6 py-20 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <Icon aria-hidden className="size-6 text-slate-400" />
          </div>

          <h2 className="heading text-base">Not built yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            The API endpoints behind this screen still need JSON contracts with
            pagination, and — where money is involved — server-authoritative totals.
          </p>

          {item?.legacy && (
            <div className="mx-auto mt-7 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
              <span className="text-xs text-slate-500">Replaces</span>
              <code className="text-xs font-medium text-slate-700">{item.legacy}</code>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
