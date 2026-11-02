import { useEffect, useState } from "react";
import clsx from "clsx";
import type { InventoryInwardRow } from "@accountmanagement/contracts";
import { HandHelping, Package } from "lucide-react";
import { Button, Modal } from "../../components/ui";
import { formatQuantity } from "../../lib/format";
import { AuthedPhoto } from "./photos";

export type ChosenPiece = { arrivalId: string; n: number; tag: string; hasPhoto: boolean };

/**
 * AN ARRIVAL'S PIECES (client, 2 Nov 2026): "click the electric board and its five
 * boards show, each with its photo; I tick the ones to issue". A piece out on an
 * issue says so and cannot be ticked until it is received back.
 */
export function ArrivalPiecesDialog({
  arrival,
  canIssue,
  onClose,
  onIssue,
}: {
  /** Null keeps it closed. */
  arrival: InventoryInwardRow | null;
  canIssue: boolean;
  onClose: () => void;
  onIssue: (arrival: InventoryInwardRow, pieces: ChosenPiece[]) => void;
}) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  useEffect(() => setTicked(new Set()), [arrival?.id]);

  const pieces = arrival?.pieces ?? [];
  const issuable = canIssue && !!arrival?.inventoryItemId;
  const toggle = (n: number) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(n)) next.add(n);
      return next;
    });

  return (
    <Modal
      open={arrival !== null}
      onClose={onClose}
      title={arrival?.itemName ?? ""}
      description={
        arrival
          ? `${formatQuantity(arrival.quantity)} ${arrival.unitName}${arrival.siteName ? ` · ${arrival.siteName}` : ""}${issuable ? " · tick the pieces to issue" : ""}`
          : undefined
      }
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {issuable && (
            <Button
              icon={HandHelping}
              disabled={ticked.size === 0}
              onClick={() =>
                arrival &&
                onIssue(
                  arrival,
                  [...ticked].sort((a, b) => a - b).map((n) => ({
                    arrivalId: arrival.id,
                    n,
                    tag: pieces[n]?.tag ?? "",
                    hasPhoto: pieces[n]?.hasPhoto ?? false,
                  })),
                )
              }
            >
              {ticked.size === 0 ? "Issue selected" : `Issue ${ticked.size} selected`}
            </Button>
          )}
        </>
      }
    >
      {pieces.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          This arrival has no pieces tagged one by one. Edit it to give each piece a tag name and a photo.
        </p>
      ) : (
        <ul aria-label="Pieces" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {pieces.map((piece, n) => {
            const name = piece.tag || `Piece ${n + 1}`;
            const on = ticked.has(n);
            return (
              <li
                key={n}
                className={clsx(
                  "flex flex-col overflow-hidden rounded-lg ring-1",
                  on ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200",
                  piece.out && "opacity-60",
                )}
              >
                {piece.hasPhoto && arrival ? (
                  <AuthedPhoto
                    path={`/inventory-issues/arrivals/${arrival.id}/pieces/${n}/photo`}
                    alt={name}
                    className="aspect-square w-full rounded-none"
                    fill
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center bg-slate-50 text-slate-300" title="No photo">
                    <Package aria-hidden className="size-8" />
                  </span>
                )}
                <label className={clsx("flex items-center gap-2 p-2 text-sm", piece.out || !issuable ? "cursor-default" : "cursor-pointer")}>
                  {issuable && (
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-brand-600"
                      checked={on}
                      disabled={piece.out}
                      onChange={() => toggle(n)}
                      aria-label={`Issue ${name}`}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={name}>
                    {name}
                  </span>
                  {piece.out && <span className="text-xs font-medium text-amber-700">Issued</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
