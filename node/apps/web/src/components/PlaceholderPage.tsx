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
        {/* Compact. This was 80px of padding around a 56px tile - an
            announcement, where the honest content is one sentence. */}
        <div className="px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-slate-100">
            <Icon aria-hidden className="size-4 text-slate-400" />
          </div>

          <h2 className="heading text-sm">Not built yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-5 text-slate-500">
            The API endpoints behind this screen still need JSON contracts with
            pagination, and — where money is involved — server-authoritative totals.
          </p>

          {item?.legacy && (
            <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 ring-1 ring-inset ring-slate-200">
              <span className="text-xs text-slate-500">Replaces</span>
              <code className="text-xs font-medium text-slate-700">{item.legacy}</code>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
