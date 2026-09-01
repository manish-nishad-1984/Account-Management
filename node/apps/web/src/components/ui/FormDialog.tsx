import type { ReactNode } from "react";
import { Alert, Button } from "./index";
import { Modal } from "./Modal";

/**
 * The shell every master's create/edit form sits in.
 *
 * Holds the parts that are identical on all of them — the `<form>` element with
 * its submit wiring, the form-level error banner, and the Cancel/Save footer —
 * so each screen contributes only its fields.
 *
 * The submit button lives in the modal footer but belongs to the form, which is
 * what the `form` attribute is for: without it, a footer button outside the
 * `<form>` element does not submit it, and Enter in a text field would do
 * nothing.
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
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const formId = "form-dialog";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="space-y-5"
      >
        {formError && <Alert tone="danger">{formError}</Alert>}
        {children}
      </form>
    </Modal>
  );
}
