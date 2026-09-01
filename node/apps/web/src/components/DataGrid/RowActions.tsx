import { Pencil, Trash2 } from "lucide-react";
import type { RowCapabilities } from "@accountmanagement/contracts";
import { Button } from "../ui";

/**
 * The Edit / Delete cell, driven by the capability flags the server puts on each
 * row.
 *
 * The buttons render from `row.capabilities`, not from the caller's permission
 * list, because the server is the only thing that knows whether a right is
 * row-dependent. Today none of them are; when site scoping arrives they will be,
 * and this component does not change.
 *
 * Hiding a button is a convenience, never a control: `PermissionsGuard` checks
 * the same right again on the call. In the .NET app the check existed ONLY in the
 * Razor partial that drew the button, which is why a view-only clerk could
 * approve their own invoices by calling the API directly (assessment §3.3).
 */
export function RowActions({
  capabilities,
  label,
  onEdit,
  onDelete,
}: {
  capabilities: RowCapabilities;
  /** Names the record, so each button's accessible name is unique in the table. */
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (!capabilities.canEdit && !capabilities.canDelete) {
    return null;
  }

  return (
    <div className="flex justify-end gap-1">
      {capabilities.canEdit && (
        <Button
          variant="ghost"
          icon={Pencil}
          className="px-2 py-1 text-xs"
          aria-label={`Edit ${label}`}
          onClick={onEdit}
        >
          Edit
        </Button>
      )}
      {capabilities.canDelete && (
        <Button
          variant="ghost"
          icon={Trash2}
          className="px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          aria-label={`Delete ${label}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
    </div>
  );
}
