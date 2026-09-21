import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Alert, Button } from "./index";
import { Modal } from "./Modal";
import { SidePanel } from "./SidePanel";
import { RecordPage } from "./RecordPage";
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
 * `RecordLayoutContext` chooses between a centred modal over the list, a panel
 * docked beside it as the legacy screens do, and the record taking the content
 * area outright behind a back arrow. Every form in the application inherits all
 * three without knowing any of them exists — which is why the choice can still
 * be put to the business cheaply, and why it should be settled before more
 * screens are built. See that file for the question being asked.
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
  footerStart,
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
  /** Actions on the record itself, at the footer's left, apart from Cancel and Save. */
  footerStart?: ReactNode;
  children: ReactNode;
}) {
  const formId = "form-dialog";
  const { layout, setPaneOpen, setPageOpen, pageHost } = useRecordLayout();
  const docked = layout === "split";
  const full = layout === "page";

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

  /**
   * Tell the shell to hide the list under the record, and show it again after.
   *
   * The unmount cleanup matters MORE here than it does for the pane. A pane left
   * open by a screen that navigated away costs a narrowed content area with a
   * gap beside it — visibly wrong, but everything still works. A `pageOpen` left
   * set hides the routed page of every screen the user goes to next, with
   * nothing rendered over it: a blank application and no way to explain it.
   */
  useEffect(() => {
    if (!full) return;
    setPageOpen(open);
    return () => setPageOpen(false);
  }, [full, open, setPageOpen]);

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
      {footerStart && <div className="mr-auto flex items-center gap-2">{footerStart}</div>}
      <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={pending}>
        {submitLabel}
      </Button>
    </>
  );

  if (full) {
    if (!open) return null;

    const page = (
      /*
        No `size`. A modal is sized because it floats over the list and has to
        leave some of it visible; a page has the content area and `FormSection`
        decides how many columns fill it.
      */
      <RecordPage onClose={onClose} title={title} description={description} footer={footer}>
        {body}
      </RecordPage>
    );

    /*
     * Into the shell's host when there is one, in place when there is not.
     *
     * The host is inside the content area and OUTSIDE the element the shell
     * hides, which is the only reason a form rendered by the screen can survive
     * its own screen being hidden. With no shell — a test, a story — there is
     * nothing hiding anything, so rendering where it stands is both simpler and
     * honest about what is on screen.
     */
    return pageHost ? createPortal(page, pageHost) : page;
  }

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
