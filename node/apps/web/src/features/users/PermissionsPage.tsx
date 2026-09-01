import { useEffect, useMemo, useState } from "react";
import {
  RIGHT_COLUMNS,
  RIGHT_LABELS,
  type FormPermission,
  type RightColumn,
  type UserRow,
} from "@accountmanagement/contracts";
import { Save, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { usePermission } from "../../lib/permissions";
import { useSaveUserPermissions, useUserList, useUserPermissions } from "./api";

/**
 * The user-wise permission matrix — `/User/UserwisePermission` in the .NET app.
 *
 * Pick a user on the left, tick rights on the right. Every permission the whole
 * system checks comes from this table: `permission(formName, right)` turns
 * "Supplier Invoice" + edit into `supplier-invoice.edit`, which is what
 * `PermissionsGuard` compares against.
 *
 * ROLES ARE ABSENT, deliberately. `UserRole` and `RolewiseFormPermission` exist
 * in the source schema but cannot be joined to `User` — `User.RoleId` is `Guid?`
 * against their `int` — and neither table is referenced anywhere in the
 * repository layer. Role-based permissions have never worked. A screen offering
 * them would be offering something that does nothing.
 */
export function PermissionsPage() {
  const canEdit = usePermission("user", "edit");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<number, FormPermission>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const users = useUserList({ limit: 200, sortBy: "userName", sortDir: "asc", search: search.trim() || undefined });
  const matrix = useUserPermissions(selectedUser?.id ?? null);
  const save = useSaveUserPermissions();

  // The fetched matrix seeds the draft; every tick edits the draft until saved.
  useEffect(() => {
    if (!matrix.data) return;
    setDraft(
      Object.fromEntries(
        matrix.data.rows.map((row) => [
          row.formId,
          {
            formId: row.formId,
            isViewAllow: row.isViewAllow,
            isAddAllow: row.isAddAllow,
            isEditAllow: row.isEditAllow,
            isDeleteAllow: row.isDeleteAllow,
            isApproved: row.isApproved,
          },
        ]),
      ),
    );
    setSaveError(null);
    setSaved(false);
  }, [matrix.data]);

  const dirty = useMemo(() => {
    if (!matrix.data) return false;
    return matrix.data.rows.some((row) => {
      const current = draft[row.formId];
      return current && RIGHT_COLUMNS.some((column) => current[column] !== row[column]);
    });
  }, [draft, matrix.data]);

  /**
   * Ticking any right ticks View with it; unticking View unticks everything.
   *
   * A right without View is unreachable — the screen it applies to cannot be
   * opened — and the server refuses the combination outright. Silently keeping
   * the two consistent is friendlier than a validation error for something the
   * user cannot have meant. The server still enforces it, because a direct API
   * call never passes through this component.
   */
  const toggle = (formId: number, column: RightColumn) => {
    setSaved(false);
    setDraft((current) => {
      const row = current[formId];
      if (!row) return current;

      const next = { ...row, [column]: !row[column] };

      if (column === "isViewAllow" && !next.isViewAllow) {
        next.isAddAllow = false;
        next.isEditAllow = false;
        next.isDeleteAllow = false;
        next.isApproved = false;
      } else if (column !== "isViewAllow" && next[column]) {
        next.isViewAllow = true;
      }

      return { ...current, [formId]: next };
    });
  };

  const onSave = async () => {
    if (!selectedUser) return;
    setSaveError(null);
    try {
      await save.mutateAsync({ id: selectedUser.id, body: { rows: Object.values(draft) } });
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof ApiError ? error.message : "Could not save these permissions",
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Permissions"
        description="What each user may see and do, per screen"
        actions={
          selectedUser && canEdit ? (
            <Button icon={Save} onClick={onSave} loading={save.isPending} disabled={!dirty}>
              {dirty ? "Save permissions" : "Saved"}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card padded={false}>
          <div className="border-b border-slate-200/80 p-3">
            <input
              aria-label="Search users"
              placeholder="Search users…"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className="w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 transition-shadow placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500"
            />
          </div>
          <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
            {users.isLoading ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">Loading users…</li>
            ) : (users.data?.rows ?? []).length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-500">No users match</li>
            ) : (
              (users.data?.rows ?? []).map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(user)}
                    aria-current={selectedUser?.id === user.id}
                    className={
                      "flex w-full flex-col items-start px-3 py-2.5 text-left transition-colors " +
                      (selectedUser?.id === user.id
                        ? "bg-brand-50 text-brand-900"
                        : "hover:bg-slate-50")
                    }
                  >
                    <span className="text-sm font-medium">{user.userName}</span>
                    <span className="text-xs text-slate-500">
                      {user.firstName} {user.lastName}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Card>

        <Card padded={false}>
          {!selectedUser ? (
            <EmptyState
              icon={ShieldCheck}
              title="Choose a user"
              description="Pick someone on the left to see and change what they may do."
            />
          ) : matrix.isLoading ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">Loading permissions…</p>
          ) : (
            <>
              <div className="border-b border-slate-200/80 px-4 py-3">
                <CardHeader
                  title={`Permissions for ${selectedUser.userName}`}
                  description="Ticking any right grants View with it — a right without View cannot be reached."
                />
                {saveError && <Alert tone="danger">{saveError}</Alert>}
                {saved && !dirty && !saveError && (
                  <Alert tone="success">
                    Saved. The user picks these up the next time they sign in — an
                    access token already issued keeps the rights it was minted with
                    until it expires.
                  </Alert>
                )}
                {!canEdit && (
                  <Alert tone="info">
                    You have view-only access to permissions. Changing them needs
                    the Edit right on the User screen.
                  </Alert>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200/80 text-sm">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500"
                      >
                        Screen
                      </th>
                      {RIGHT_COLUMNS.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500"
                        >
                          {RIGHT_LABELS[column]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(matrix.data?.rows ?? []).map((row) => {
                      const current = draft[row.formId];
                      return (
                        <tr key={row.formId} className="hover:bg-slate-50/70">
                          <th scope="row" className="px-4 py-2.5 text-left font-normal">
                            <div className="font-medium text-slate-800">{row.formName}</div>
                            {/*
                              Show the permission string the ticks produce. It is
                              what appears in the token and in every guard, and
                              leaving the reader to apply the slug rule in their
                              head is how "Supplier Invoice" and
                              "supplier-invoice" drift apart.
                            */}
                            <div className="text-xs text-slate-400">
                              <code>{row.subject}.*</code>
                              {row.formGroup && (
                                <span className="ml-2 text-slate-400">{row.formGroup}</span>
                              )}
                            </div>
                          </th>
                          {RIGHT_COLUMNS.map((column) => (
                            <td key={column} className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                disabled={!canEdit}
                                checked={current?.[column] ?? false}
                                onChange={() => toggle(row.formId, column)}
                                aria-label={`${RIGHT_LABELS[column]} on ${row.formName}`}
                                className="size-4 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-0 disabled:opacity-40"
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-200/80 bg-slate-50/40 px-4 py-3 text-xs text-slate-500">
                <Badge tone="neutral">Note</Badge>{" "}
                Roles are not shown. The source schema has <code>UserRole</code> and{" "}
                <code>RolewiseFormPermission</code>, but <code>User.RoleId</code> is a
                GUID while both role tables key on an integer, so they cannot join —
                and nothing in the repository layer reads them. Role permissions have
                never worked; only these per-user grants do.
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
