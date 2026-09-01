import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CircleCheck,
  KeyRound,
  LayoutGrid,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";
import { DEFAULT_PAGE_SIZE } from "@accountmanagement/contracts";
import { useAuth } from "../../contexts/AuthContext";
import { useUserList } from "../users/api";
import { Badge, Card, CardHeader, PageHeader } from "../../components/ui";
import { NAV } from "../../navigation/nav";

/**
 * The .NET dashboard (`/Home/Index`) is six pending-approval queues with bulk
 * approve. Those endpoints do not exist on the new API yet, so this shows what is
 * genuinely known and states the rest plainly — never invented figures. A
 * financial dashboard that looks populated but is not would be worse than one
 * that admits it.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const users = useUserList({ limit: DEFAULT_PAGE_SIZE, sortBy: "userName", sortDir: "asc" });

  const legacyPasswords = users.data?.rows.filter((row) => row.passwordIsLegacy).length ?? 0;
  const screens = NAV.flatMap((section) => section.items);
  const migrated = screens.filter((item) => item.status === "ready").length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.userName ?? ""}`}
        description="Procurement and accounting overview"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={UsersIcon}
          label="Users"
          value={users.data?.total ?? null}
          hint="In the system directory"
          loading={users.isLoading}
        />
        <StatCard
          icon={KeyRound}
          label="Legacy passwords"
          value={legacyPasswords}
          hint={legacyPasswords > 0 ? "Hashed on next sign-in" : "None on this page"}
          tone={legacyPasswords > 0 ? "warning" : "success"}
          loading={users.isLoading}
        />
        <StatCard
          icon={ShieldCheck}
          label="Your permissions"
          value={user?.permissions.length ?? 0}
          hint="Enforced server-side"
          tone="info"
        />
        <StatCard
          icon={LayoutGrid}
          label="Screens migrated"
          value={migrated}
          hint={`of ${screens.length} in the module tree`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Approval queues"
            description="The six queues on the current dashboard"
            action={<Badge tone="neutral">Not migrated</Badge>}
          />

          <ul className="divide-y divide-slate-100">
            {[
              "Purchase requests",
              "Purchase orders",
              "Inward challans",
              "Purchase invoices",
              "Sales invoices",
              "Payments",
            ].map((queue) => (
              <li key={queue} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-slate-600">{queue} awaiting approval</span>
                <span className="rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-inset ring-slate-200">
                  endpoint pending
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
            Each queue needs a paginated JSON endpoint before it can be shown. The
            current implementation loads and rewrites entire tables to bulk approve,
            which is one of the six full-table scans identified in the assessment.
          </p>
        </Card>

        <Card>
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
              convenience, never the control.
            </p>
          </div>

          <Link
            to="/users"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 transition-colors hover:text-brand-700"
          >
            Manage users
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>
      </div>
    </>
  );
}

const TONE_STYLES = {
  neutral: { icon: "bg-slate-100 text-slate-500", value: "text-slate-900" },
  success: { icon: "bg-emerald-50 text-emerald-600", value: "text-slate-900" },
  warning: { icon: "bg-amber-50 text-amber-600", value: "text-amber-600" },
  info: { icon: "bg-brand-50 text-brand-600", value: "text-slate-900" },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  loading = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  hint?: string;
  tone?: keyof typeof TONE_STYLES;
  loading?: boolean;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <Card className="transition-shadow duration-200 hover:shadow-raised">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </div>
          {loading ? (
            <div className="mt-2 h-9 w-16 animate-pulse rounded-md bg-slate-100" />
          ) : (
            <div className={`tabular mt-1 text-3xl font-semibold tracking-tight ${styles.value}`}>
              {value ?? "—"}
            </div>
          )}
          {hint && <div className="mt-1 truncate text-xs text-slate-500">{hint}</div>}
        </div>
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}>
          <Icon aria-hidden className="size-5" />
        </div>
      </div>
    </Card>
  );
}
