import { AlertTriangle } from "lucide-react";
import { Alert, Button } from "./index";
import { Modal } from "./Modal";

/**
 * The confirmation every destructive action goes through.
 *
 * Two things it does that a `window.confirm` cannot:
 *
 *  - it NAMES the record. "Delete Anand Buildcon?" is a different question from
 *    "Are you sure?", and it is the one that catches a click on the wrong row;
 *  - it stays open and shows the server's refusal. Deletes here are frequently
 *    refused for a good reason — "this company still has 20 assigned users" —
 *    and that message is the useful part of the interaction, not an error to
 *    dismiss.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Delete",
  pending = false,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  error?: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-50">
            <AlertTriangle aria-hidden className="size-4.5 text-rose-600" />
          </div>
          <div className="text-sm text-slate-600">{body}</div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
