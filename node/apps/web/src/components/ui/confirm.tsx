import { useEffect, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * "ARE YOU SURE?" BEFORE ANYTHING IS REMOVED, ANYWHERE (client, 21 Oct 2026:
 * "kahi pe bhi delete karne par, confirmation message").
 *
 * Every list already asked before deleting a record, through its own
 * `ConfirmDialog`. The rest did not: a challan's attachment, a unit, and every
 * line, row and contact inside a form went at one click. Giving each of those
 * its own dialog state would be a dozen copies of the same twenty lines, so
 * they call `askConfirm`, which answers `true` or `false`, and the one
 * `ConfirmHost` mounted at the root draws the same dialog the lists use.
 */
export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  /** "Delete" unless said otherwise; "Remove" for a line of a form. */
  confirmLabel?: string;
}

type Pending = ConfirmRequest & { answer: (yes: boolean) => void };

let show: ((request: Pending) => void) | null = null;

export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) {
      show({ ...request, answer: resolve });
      return;
    }
    // No host on screen: the browser's own question, never a silent yes.
    const text = typeof request.body === "string" ? `${request.title}\n\n${request.body}` : request.title;
    resolve(typeof window.confirm === "function" ? window.confirm(text) === true : false);
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    show = (request) =>
      setPending((current) => {
        current?.answer(false);
        return request;
      });
    return () => {
      show = null;
    };
  }, []);

  const finish = (yes: boolean) => {
    pending?.answer(yes);
    setPending(null);
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      onClose={() => finish(false)}
      onConfirm={() => finish(true)}
      title={pending?.title ?? ""}
      body={pending?.body ?? null}
      confirmLabel={pending?.confirmLabel ?? "Delete"}
    />
  );
}

/** The question for a line of a form: nothing is saved until Save, and it says so. */
export const confirmRemoveRow = (what: string): Promise<boolean> =>
  askConfirm({
    title: `Remove ${what}?`,
    body: `${what.charAt(0).toUpperCase()}${what.slice(1)} will be taken off this form. Nothing is saved until you press Save.`,
    confirmLabel: "Remove",
  });
