import { useState } from "react";
import clsx from "clsx";
import { History } from "lucide-react";
import type { AuditAction, AuditEntity, AuditEvent } from "@accountmanagement/contracts";
import { Button, Modal, Spinner } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useAuditHistory } from "./api";

const ACTION: Record<AuditAction, { label: string; tone: string }> = {
  created: { label: "Created", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  imported: { label: "Imported", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  updated: { label: "Changed", tone: "bg-brand-50 text-brand-700 ring-brand-200" },
  approved: { label: "Approved", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  unapproved: { label: "Approval removed", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  confirmed: { label: "Confirmed", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  reversed: { label: "Reversed", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  deleted: { label: "Deleted", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
};

const blank = (value: string | null) =>
  value === null || value === "" ? <span className="text-slate-400">—</span> : value;

/** Old and new, field by field. */
function Changes({ event }: { event: AuditEvent }) {
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead className="text-slate-500">
        <tr>
          <th className="w-40 py-1 pr-2 font-medium">Field</th>
          <th className="py-1 pr-2 font-medium">Before</th>
          <th className="py-1 font-medium">After</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 align-top">
        {(event.changes ?? []).map((change) => (
          <tr key={change.field}>
            <td className="py-1 pr-2 font-medium text-slate-700">{change.field}</td>
            <td className="py-1 pr-2 text-rose-700 line-through decoration-rose-300">{blank(change.from)}</td>
            <td className="py-1 text-emerald-800">{blank(change.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The record as it read: open for a deleted one, behind a click otherwise. */
function Facts({ event, open }: { event: AuditEvent; open: boolean }) {
  return (
    <details open={open} className="mt-2 text-xs">
      <summary className="cursor-pointer text-slate-500 hover:text-brand-700">
        {event.action === "deleted" ? "As it was when deleted" : "Every field"}
      </summary>
      <dl className="mt-1 grid grid-cols-[10rem_1fr] gap-x-2 gap-y-0.5">
        {event.facts.map(([field, value]) => (
          <div key={field} className="contents">
            <dt className="font-medium text-slate-600">{field}</dt>
            <dd className="text-slate-800">{blank(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function AuditEventCard({ event, showLabel = false }: { event: AuditEvent; showLabel?: boolean }) {
  const action = ACTION[event.action];
  const hasChanges = (event.changes?.length ?? 0) > 0;
  return (
    <li className="rounded-lg p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", action.tone)}>{action.label}</span>
        {showLabel && <span className="font-medium text-slate-800">{event.label}</span>}
        <span className="text-slate-600">
          by <span className="font-medium text-slate-800">{event.actorName ?? "unknown"}</span>
        </span>
        <span className="text-slate-500">· {formatDateTime(event.at)}</span>
      </div>
      {hasChanges && <Changes event={event} />}
      {(!hasChanges || event.action === "deleted") && <Facts event={event} open={event.action === "deleted"} />}
    </li>
  );
}

/**
 * "History" on a purchase invoice, a payment or a payout list (client, 20 Oct
 * 2026): who did what, when, and each field's old and new value, newest first.
 */
export function HistoryDialog({
  entity,
  entityId,
  title,
  onClose,
}: {
  entity: AuditEntity;
  /** Null keeps it closed. */
  entityId: string | null;
  title: string;
  onClose: () => void;
}) {
  const history = useAuditHistory(entity, entityId, { enabled: entityId !== null });
  const events = history.data?.rows ?? [];
  return (
    <Modal open={entityId !== null} onClose={onClose} title={`History · ${title}`} description="Who did what, and when; what changed shows before and after" size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {history.isLoading ? (
        <div className="flex justify-center py-8"><Spinner label="Loading history" /></div>
      ) : history.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-rose-700">The history could not be loaded.</p>
      ) : events.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          No history yet. Changes are recorded from 20 Oct 2026; anything older shows only who made it and who last changed it.
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <AuditEventCard key={event.id} event={event} />
          ))}
        </ol>
      )}
    </Modal>
  );
}

/** The button that opens a record's history, for a form's footer. */
export function HistoryButton({ entity, entityId, title }: { entity: AuditEntity; entityId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={History} onClick={() => setOpen(true)}>
        History
      </Button>
      <HistoryDialog entity={entity} entityId={open ? entityId : null} title={title} onClose={() => setOpen(false)} />
    </>
  );
}

/** "Deleted" on the purchase invoice list: every invoice deleted, as it read when it went. */
export function DeletedRecordsDialog({ entity, open, title, onClose }: { entity: AuditEntity; open: boolean; title: string; onClose: () => void }) {
  const deleted = useAuditHistory(entity, null, { action: "deleted", enabled: open });
  const events = deleted.data?.rows ?? [];
  return (
    <Modal open={open} onClose={onClose} title={title} description="Kept as each read when it was deleted, newest first" size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {deleted.isLoading ? (
        <div className="flex justify-center py-8"><Spinner label="Loading" /></div>
      ) : deleted.isError ? (
        <p role="alert" className="py-6 text-center text-sm text-rose-700">The list could not be loaded.</p>
      ) : events.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nothing has been deleted since 20 Oct 2026.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <AuditEventCard key={event.id} event={event} showLabel />
          ))}
        </ol>
      )}
    </Modal>
  );
}
