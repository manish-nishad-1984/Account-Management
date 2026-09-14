import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, History, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ItemLatestPrice } from "@accountmanagement/contracts";
import { formatDate } from "../../lib/format";
import { latestPriceQuery } from "../items/api";

/**
 * FILLS AN INVOICE LINE WITH THE ITEM'S LATEST PRICE the moment the item is
 * chosen (client request, 14 Sep 2026).
 *
 * Price, unit, GST rate and discount are all filled from ONE source row: the newest
 * invoice line for that item in the same direction, or the item master when it
 * has never been invoiced. They are overwritten, because choosing a different
 * item makes the previous item's figures wrong. The caller sets a blank quantity
 * to 1. Everything filled stays editable.
 *
 * A slow answer for an item the person has since changed is thrown away, so a
 * quick second choice can never be overwritten by the first one's price.
 *
 * Only a choice made in the form triggers this. Opening a saved invoice for
 * editing never rewrites its prices.
 */
export interface LatestPriceFill {
  onItemChosen: (index: number, itemId: string) => void;
  /** The icon inside a line's Price box saying where its price came from, or null. */
  hintFor: (itemId: unknown) => React.ReactNode;
}

export function useLatestPriceFill({
  direction,
  currentItemId,
  fill,
}: {
  direction: "out" | "in";
  /** Read at the moment the answer arrives, from the form itself. */
  currentItemId: (index: number) => unknown;
  fill: (index: number, price: ItemLatestPrice) => void;
}): LatestPriceFill {
  const client = useQueryClient();
  const [found, setFound] = useState<Record<string, ItemLatestPrice>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // The latest callbacks, without making `onItemChosen` change identity on
  // every render of the form.
  const latest = useRef({ currentItemId, fill });
  latest.current = { currentItemId, fill };

  const onItemChosen = useCallback(
    (index: number, itemId: string) => {
      if (!itemId) return;
      setPending((state) => ({ ...state, [itemId]: true }));
      setFailed((state) => ({ ...state, [itemId]: false }));

      client
        .fetchQuery(latestPriceQuery(itemId, direction))
        .then((price) => {
          setFound((state) => ({ ...state, [itemId]: price }));
          if (String(latest.current.currentItemId(index) ?? "") === itemId) {
            latest.current.fill(index, price);
          }
        })
        .catch(() => setFailed((state) => ({ ...state, [itemId]: true })))
        .finally(() => setPending((state) => ({ ...state, [itemId]: false })));
    },
    [client, direction],
  );

  const hintFor = useCallback(
    (itemId: unknown) => {
      const id = String(itemId ?? "");
      if (!id) return null;
      if (pending[id]) return <PriceHint tone="pending" label="Finding the latest price" />;
      if (failed[id]) return <PriceHint tone="failed" label="The latest price could not be found" />;
      const price = found[id];
      return price ? <LatestPriceHint price={price} /> : null;
    },
    [found, pending, failed],
  );

  return { onItemChosen, hintFor };
}

/**
 * A 14px icon inside the Price box, so the line stays one row tall. The full
 * sentence is its tooltip and its accessible name, which is what a screen
 * reader and the tests read.
 */
function PriceHint({
  label,
  tone,
}: {
  label: string;
  tone: "invoice" | "master" | "pending" | "failed";
}) {
  const Icon = tone === "pending" ? Loader2 : tone === "failed" ? AlertTriangle : History;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      <Icon
        aria-hidden
        className={clsx(
          "size-3.5",
          tone === "invoice" && "text-brand-600",
          tone === "master" && "text-slate-400",
          tone === "pending" && "animate-spin text-slate-400",
          tone === "failed" && "text-amber-600",
        )}
      />
    </span>
  );
}

/** Where the filled price came from, as the icon's tooltip. */
export function LatestPriceHint({ price }: { price: ItemLatestPrice }) {
  if (price.source === "item-master") {
    return <PriceHint tone="master" label="Item master price. This item has not been invoiced yet." />;
  }

  const kind = price.source === "purchase-invoice" ? "purchase" : "sale";
  const label = [
    `Last ${kind}`,
    price.documentDate ? formatDate(price.documentDate) : null,
    price.displayNo ? `invoice ${price.displayNo}` : null,
    price.partyName,
  ]
    .filter(Boolean)
    .join(" · ");

  return <PriceHint tone="invoice" label={label} />;
}
