import { useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Pencil, Trash2 } from "lucide-react";
import type { InventoryItemRow } from "@accountmanagement/contracts";
import { Alert, Button, Modal, TextField } from "../../components/ui";
import { askConfirm } from "../../components/ui/confirm";
import { ApiError } from "../../lib/api-client";
import { formatQuantity } from "../../lib/format";
import { useSiteScope } from "../../contexts/SiteScopeContext";
import { AuthedPhoto, PhotoInput } from "./photos";
import { useDeleteInventoryItem, useInventoryItems, usePurchaseStock, useSaveInventoryItem } from "./stock-api";

/** An inventory item's name, unit and photo, corrected. */
function ItemDialog({ item, onClose }: { item: InventoryItemRow | null; onClose: () => void }) {
  const save = useSaveInventoryItem();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [photoKey, setPhotoKey] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(item?.name ?? "");
    setUnit(item?.unit ?? "");
    setPhotoKey(undefined);
    setError(null);
  }, [item]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!item) return;
    try {
      await save.mutateAsync({ id: item.id, body: { name: name.trim(), unit: unit.trim() || "Nos", note: item.note, photoKey } });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save the item.");
    }
  };

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title="Edit inventory item"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="inventory-item-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="inventory-item-form" onSubmit={(event) => void submit(event)} className="space-y-3">
        <TextField label="Name" required value={name} onChange={(event) => setName(event.target.value)} />
        <TextField label="Unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
        <PhotoInput label="Photo" currentPath={item?.hasPhoto ? `/inventory-items/${item.id}/photo` : null} onChange={setPhotoKey} />
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}

/**
 * The Inventory screen's "Stock" tab (client, 26 Oct 2026): the inventory item
 * master with what is in stock and what is out, and, apart, the purchase items
 * the site has received on its challans.
 */
export function StockView() {
  const scope = useSiteScope();
  const [kind, setKind] = useState<"inventory" | "purchase">("inventory");
  const [editing, setEditing] = useState<InventoryItemRow | null>(null);
  const items = useInventoryItems(scope.siteId);
  const purchase = usePurchaseStock(kind === "purchase" ? scope.siteId : null);
  const remove = useDeleteInventoryItem();
  const [error, setError] = useState<string | null>(null);

  const drop = async (item: InventoryItemRow) => {
    setError(null);
    const yes = await askConfirm({ title: "Delete inventory item", body: <p>Delete {item.name} from the inventory item master?</p> });
    if (!yes) return;
    remove.mutate(item.id, { onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not delete it.") });
  };

  return (
    <>
      <div role="tablist" aria-label="Stock of" className="mb-3 inline-flex rounded-md ring-1 ring-inset ring-slate-300">
        {(
          [
            ["inventory", "Inventory items"],
            ["purchase", "Purchase items"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => setKind(value)}
            className={clsx(
              "px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md",
              kind === value ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Alert className="mb-3">{error}</Alert>}

      <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
        {kind === "inventory" ? (
          (items.data?.rows ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {items.isLoading ? "Loading…" : "No inventory items yet. Record a New Arrival to add one."}
            </p>
          ) : (
            <table className="w-full text-sm" aria-label="Inventory item stock">
              <thead className="bg-surface-muted text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Item</th>
                  <th className="px-3 py-2.5 text-right font-medium">In stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Out (to come back)</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.data!.rows.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {item.hasPhoto && <AuthedPhoto path={`/inventory-items/${item.id}/photo`} alt={item.name} className="size-10" />}
                        <span className="font-medium text-slate-900">{item.name}</span>
                      </div>
                    </td>
                    <td className="tabular px-3 py-2 text-right font-medium text-slate-900">
                      {formatQuantity(item.stock)} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-amber-700">{Number(item.out) > 0 ? formatQuantity(item.out) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {item.capabilities.canEdit && (
                        <button type="button" aria-label={`Edit ${item.name}`} onClick={() => setEditing(item)} className="rounded p-1.5 text-sky-600 hover:bg-sky-50">
                          <Pencil aria-hidden className="size-4" />
                        </button>
                      )}
                      {item.capabilities.canDelete && (
                        <button type="button" aria-label={`Delete ${item.name}`} onClick={() => void drop(item)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700">
                          <Trash2 aria-hidden className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : !scope.siteId ? (
          <p className="py-8 text-center text-sm text-slate-500">Choose a site in the header to see its purchase item stock.</p>
        ) : (purchase.data ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{purchase.isLoading ? "Loading…" : "Nothing received on this site's inward challans."}</p>
        ) : (
          <table className="w-full text-sm" aria-label="Purchase item stock">
            <thead className="bg-surface-muted text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Item</th>
                <th className="px-3 py-2.5 text-right font-medium">Received (challans)</th>
                <th className="px-3 py-2.5 text-right font-medium">In stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Out (to come back)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchase.data!.map((row) => (
                <tr key={row.itemId}>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.itemName}</td>
                  <td className="tabular px-3 py-2 text-right text-slate-700">{formatQuantity(row.received)}</td>
                  <td className="tabular px-3 py-2 text-right font-medium text-slate-900">
                    {formatQuantity(row.stock)} <span className="text-xs font-normal text-slate-500">{row.unitName ?? ""}</span>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-amber-700">{Number(row.out) > 0 ? formatQuantity(row.out) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ItemDialog item={editing} onClose={() => setEditing(null)} />
    </>
  );
}
