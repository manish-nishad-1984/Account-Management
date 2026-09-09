import { useEffect, type ReactNode } from "react";
import { Alert, Button } from "./index";
import { Modal } from "./Modal";
import { SidePanel } from "./SidePanel";
import { useRecordLayout } from "../../contexts/RecordLayoutContext";

/**
 * The shell every master's create/edit form sits in.
 *
 * Holds the parts that are identical on all of them — the `<form>` element with
 * its submit wiring, the form-level error banner, and the Cancel/Save footer —
 * so each screen contributes only its fields.
 *
 * The submit button lives in the footer but belongs to the form, which is what
 * the `form` attribute is for: without it, a footer button outside the `<form>`
 * element does not submit it, and Enter in a text field would do nothing.
 *
 * WHERE THE FORM APPEARS IS DECIDED HERE, AND NOWHERE ELSE.
 *
 * `RecordLayoutContext` chooses between a centred modal over the list and a
 * panel docked beside it, as the legacy screens do. Every form in the
 * application inherits both without knowing either exists — which is why the
 * choice can still be put to the business cheaply, and why it should be settled
 * before more screens are built. See that file for the question being asked.
 */
export function FormDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  formError,
  pending = false,
  submitLabel = "Save",
  size = "lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  title: string;
  description?: string;
  formError?: string | null;
  pending?: boolean;
  submitLabel?: string;
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
}) {
  const formId = "form-dialog";
  const { layout, setPaneOpen } = useRecordLayout();
  const docked = layout === "split";

  /**
   * Tell the shell to reserve the width, and give it back on close.
   *
   * The cleanup runs on unmount too, which matters: a screen navigated away from
   * with a record open would otherwise leave the main region permanently
   * narrowed with nothing beside it.
   */
  useEffect(() => {
    if (!docked) return;
    setPaneOpen(open);
    return () => setPaneOpen(false);
  }, [docked, open, setPaneOpen]);

  const body = (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      {formError && <Alert tone="danger">{formError}</Alert>}
      {children}
    </form>
  );

  const footer = (
    <>
      <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={pending}>
        {submitLabel}
      </Button>
    </>
  );

  if (docked) {
    return (
      <SidePanel
        open={open}
        onClose={onClose}
        title={title}
        description={description}
        footer={footer}
      >
        {body}
      </SidePanel>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={footer}
    >
      {body}
    </Modal>
  );
}
