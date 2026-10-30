import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PackageOpen, Trash2, Undo2 } from "lucide-react";
import type { InventoryIssueRow, IssueStatus } from "@accountmanagement/contracts";
import { Alert, Badge, Button, Modal, SelectField, TextAreaField, TextField } from "../../components/ui";
import { askConfirm } from "../../components/ui/confirm";
import { ApiError } from "../../lib/api-client";
import { formatQuantity } from "../../lib/format";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { AuthedPhoto } from "./photos";
import { useDeleteIssue, useInventoryIssues, useReceiveIssue } from "./stock-api";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS: Record<IssueStatus, { label: string; tone: "warning" | "success" | "neutral" }> = {
  out: { label: "To receive back", tone: "warning" },
  returned: { label: "Received back", tone: "success" },
  given: { label: "Given (not returnable)", tone: "neutral" },
};

/** Receive a returnable item back; what comes back goes back into its stock (client, 26 Oct 2026). */
export function ReceiveDialog({ issue, onClose }: { issue: InventoryIssueRow | null; onClose: () => void }) {
  const receive = useReceiveIssue();
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQuantity(issue ? String(Number(issue.quantity)) : "");
    setNote("");
    setError(null);
  }, [issue]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!issue) return;
    setError(null);
    try {
      await receive.mutateAsync({ id: issue.id, quantity: quantity.trim(), note: note.trim() || null });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not receive it. Please try again.");
    }
  };

  const short = issue && quantity && Number(quantity) < Number(issue.quantity);
  return (
    <Modal
      open={issue !== null}
      onClose={onClose}
      title="Receive back"
      description={issue ? `${issue.itemName} from ${issue.personName} (${issue.agencyName})` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="receive-form" loading={receive.isPending}>
            Receive
          </Button>
        </>
      }
    >
      <form id="receive-form" onSubmit={(event) => void submit(event)} className="space-y-3">
        <TextField
          label="Quantity received"
          inputMode="decimal"
          value={quantity}
          hint={issue ? `Given: ${formatQuantity(issue.quantity)} ${issue.unitName ?? ""}` : undefined}
          onChange={(event) => setQuantity(event.target.value)}
        />
        {short && <Alert tone="warning">What does not come back stays out of stock. Say why in the note.</Alert>}
        <TextAreaField label="Note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}

/** Who has it: the person's photo, name and mobile, and the agency with its contact. */
function Taker({ issue }: { issue: InventoryIssueRow }) {
  return (
    <div className="flex items-center gap-2">
      {issue.personHasPhoto && <AuthedPhoto path={`/agency-persons/${issue.personId}/photo`} alt={issue.personName} className="size-9" />}
      <div>
        <div className="font-medium text-slate-900">
          {issue.personName}
          {issue.personMobile && <span className="ml-1 text-xs font-normal text-slate-500">{issue.personMobile}</span>}
        </div>
        <div className="text-xs text-slate-500">
          {issue.agencyName}
          {issue.contactName && ` · ${issue.contactName}${issue.contactMobile ? ` ${issue.contactMobile}` : ""}`}
        </div>
      </div>
    </div>
  );
}

function IssueTable({
  rows,
  onReceive,
  showSite,
}: {
  rows: InventoryIssueRow[];
  onReceive: (issue: InventoryIssueRow) => void;
  showSite: boolean;
}) {
  const remove = useDeleteIssue();
  const drop = async (issue: InventoryIssueRow) => {
    const yes = await askConfirm({
      title: "Delete issue",
      body: <p>Delete the issue of {issue.itemName} to {issue.personName}? What it took out of stock goes back.</p>,
    });
    if (yes) remove.mutate(issue.id);
  };
  return (
    <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
      <table className="w-full min-w-[48rem] text-sm" aria-label="Issued items">
        <thead className="bg-surface-muted text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2.5 text-left font-medium">Issued</th>
            <th className="px-3 py-2.5 text-left font-medium">Item</th>
            <th className="px-3 py-2.5 text-left font-medium">Given to</th>
            <th className="px-3 py-2.5 text-left font-medium">Status</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((issue) => (
            <tr key={issue.id}>
              <td className="tabular whitespace-nowrap px-3 py-2 text-slate-600">
                {when(issue.issuedAt)}
                {showSite && issue.siteName && <div className="text-xs text-slate-400">{issue.siteName}</div>}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {issue.itemHasPhoto && issue.inventoryItemId && (
                    <AuthedPhoto path={`/inventory-items/${issue.inventoryItemId}/photo`} alt={issue.itemName} className="size-9" />
                  )}
                  <div>
                    <div className="font-medium text-slate-900">{issue.itemName}</div>
                    <div className="text-xs text-slate-500">
                      {formatQuantity(issue.quantity)} {issue.unitName ?? ""} · {issue.source === "inventory" ? "Inventory item" : "Purchase item"}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2">
                <Taker issue={issue} />
              </td>
              <td className="px-3 py-2">
                <Badge dot tone={STATUS[issue.status].tone}>
                  {STATUS[issue.status].label}
                </Badge>
                {issue.status === "returned" && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatQuantity(issue.returnedQuantity ?? "0")} back, {when(issue.returnedAt!)}
                    {issue.returnNote && ` · ${issue.returnNote}`}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {issue.status === "out" && issue.capabilities.canEdit && (
                  <Button variant="secondary" icon={Undo2} onClick={() => onReceive(issue)}>
                    Receive
                  </Button>
                )}
                {issue.capabilities.canDelete && (
                  <button
                    type="button"
                    aria-label={`Delete the issue of ${issue.itemName} to ${issue.personName}`}
                    onClick={() => void drop(issue)}
                    className="ml-1 rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Inventory screen's "Issued items" tab. */
export function IssuesView() {
  const scope = useSiteScope();
  const [status, setStatus] = useState<IssueStatus | "">("out");
  const [receiving, setReceiving] = useState<InventoryIssueRow | null>(null);
  const issues = useInventoryIssues({ siteId: scope.siteId, status: status || undefined });
  const rows = issues.data?.rows ?? [];
  return (
    <>
      <div className="mb-3 w-60">
        <SelectField
          labelHidden
          label="Issue status"
          value={status}
          options={[
            { value: "out", label: "To receive back" },
            { value: "returned", label: "Received back" },
            { value: "given", label: "Given (not returnable)" },
            { value: "", label: "Every issue" },
          ]}
          onChange={(event) => setStatus(event.target.value as IssueStatus | "")}
        />
      </div>
      {issues.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg bg-white py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing here.</p>
      ) : (
        <IssueTable rows={rows} onReceive={setReceiving} showSite={!scope.siteId} />
      )}
      <ReceiveDialog issue={receiving} onClose={() => setReceiving(null)} />
    </>
  );
}

/**
 * ON THE DASHBOARD (client, 26 Oct 2026): what was given out and is to be taken
 * back this evening, oldest first, with Receive beside each. Shown only while
 * something is out.
 */
export function ToReceiveBack() {
  const scope = useSiteScope();
  const [receiving, setReceiving] = useState<InventoryIssueRow | null>(null);
  const issues = useInventoryIssues({ siteId: scope.siteId, status: "out" });
  const rows = [...(issues.data?.rows ?? [])].reverse();
  if (rows.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="to-receive-back">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="to-receive-back" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <PackageOpen aria-hidden className="size-4 text-amber-600" />
          To receive back ({rows.length})
        </h2>
        <Link to="/inventory?tab=issues" className="text-xs font-medium text-brand-700 hover:underline">
          All issued items
        </Link>
      </div>
      <IssueTable rows={rows} onReceive={setReceiving} showSite={!scope.siteId} />
      <ReceiveDialog issue={receiving} onClose={() => setReceiving(null)} />
    </section>
  );
}
