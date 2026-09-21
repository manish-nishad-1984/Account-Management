import { Clock } from "lucide-react";
import { Button } from "./ui";
import { Modal } from "./ui/Modal";

/**
 * "You are about to be signed out" — the last minute of the 30 idle minutes
 * (business rule, 18 Sep 2026).
 *
 * Closing it any way at all — Continue, Escape, the backdrop — keeps the session:
 * whoever does that is at the keyboard, which is the question being asked. Only
 * "Sign out" or the clock running out ends it. Anything typed but not saved is
 * lost when the clock runs out, and the sentence says so, because that is the
 * reason to answer it.
 */
export function IdleWarningDialog({
  secondsLeft,
  onContinue,
  onSignOut,
}: {
  /** Null when no warning is due. */
  secondsLeft: number | null;
  onContinue: () => void;
  onSignOut: () => void;
}) {
  return (
    <Modal
      open={secondsLeft !== null}
      onClose={onContinue}
      title="Still working?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button onClick={onContinue}>Continue working</Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 ring-1 ring-inset ring-amber-100">
          <Clock aria-hidden className="size-4 text-amber-600" />
        </div>
        <div className="space-y-2 text-sm leading-5 text-slate-600">
          <p>
            Nothing has happened here for almost 30 minutes. You will be signed out in{" "}
            <span className="tabular font-medium text-slate-900" role="timer" aria-live="off">
              {secondsLeft ?? 0} seconds
            </span>
            .
          </p>
          <p className="text-xs text-slate-500">Anything not yet saved is lost when that happens.</p>
        </div>
      </div>
    </Modal>
  );
}
