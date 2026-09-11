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
    /*
      ICONS, NOT WORDS, and that is measured rather than a matter of taste.

      With its labels this cell was 298px on every grid that carries an approval
      button — wider than any column of real data on seven of the twelve grids,
      and the largest single cause of the sideways scrolling the client
      reported. Icon-only it is about half that. Nothing is lost to a screen
      reader or to a hover: each button keeps the full sentence it already had
      as its accessible name, and now shows it as a tooltip as well.

      `gap-2` on touch, `gap-1` with a mouse. Edit and Delete sit side by side
      and Delete is destructive; 4px between two small targets is a good way to
      tap the wrong one with a thumb.
    */
    <div className="flex justify-end gap-2 lg:gap-1">
      {capabilities.canEdit && (
        <Button
          variant="ghost"
          icon={Pencil}
          className="px-2 py-2 lg:py-1.5"
          aria-label={`Edit ${label}`}
          title={`Edit ${label}`}
          onClick={onEdit}
        />
      )}
      {capabilities.canDelete && (
        <Button
          variant="ghost"
          icon={Trash2}
          className="px-2 py-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 lg:py-1.5"
          aria-label={`Delete ${label}`}
          title={`Delete ${label}`}
          onClick={onDelete}
        />
      )}
    </div>
  );
}
