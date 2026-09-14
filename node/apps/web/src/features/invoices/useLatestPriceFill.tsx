import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ItemLatestPrice } from "@accountmanagement/contracts";
import { formatDate } from "../../lib/format";
import { latestPriceQuery } from "../items/api";

/**
 * FILLS AN INVOICE LINE WITH THE ITEM'S LATEST PRICE the moment the item is
 * chosen (client request, 14 Sep 2026).
 *
 * Price, unit and GST rate are all filled from ONE source row: the newest
 * invoice line for that item in the same direction, or the item master when it
 * has never been invoiced. They are overwritten, because choosing a different
 * item makes the previous item's figures wrong. Quantity and discount are left
 * alone. Everything filled stays editable.
 *
 * A slow answer for an item the person has since changed is thrown away, so a
 * quick second choice can never be overwritten by the first one's price.
 *
 * Only a choice made in the form triggers this. Opening a saved invoice for
 * editing never rewrites its prices.
 */
export interface LatestPriceFill {
  onItemChosen: (index: number, itemId: string) => void;
  /** The small note under a line's Price box, or null. */
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
      if (pending[id]) return <PriceHint>Finding latest price…</PriceHint>;
      if (failed[id]) return <PriceHint tone="warning">Latest price not found</PriceHint>;
      const price = found[id];
      return price ? <LatestPriceHint price={price} /> : null;
    },
    [found, pending, failed],
  );

  return { onItemChosen, hintFor };
}

function PriceHint({
  children,
  title,
  tone = "muted",
}: {
  children: React.ReactNode;
  title?: string;
  tone?: "muted" | "warning";
}) {
  return (
    <div
      title={title}
      className={`mt-1 text-[10px] leading-3 ${tone === "warning" ? "text-amber-700" : "text-slate-400"}`}
    >
      {children}
    </div>
  );
}

/** Where the filled price came from, short enough for the narrow Price column. */
export function LatestPriceHint({ price }: { price: ItemLatestPrice }) {
  if (price.source === "item-master") {
    return <PriceHint title="Never invoiced yet, so the Item Master price was used">Item master price</PriceHint>;
  }

  const kind = price.source === "purchase-invoice" ? "purchase" : "sale";
  const date = price.documentDate ? formatDate(price.documentDate) : null;
  const title = [
    `Latest ${kind}`,
    price.displayNo ? `invoice ${price.displayNo}` : null,
    price.partyName,
    date,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PriceHint title={title}>
      Last {kind}
      {date ? <span className="block">{date}</span> : null}
    </PriceHint>
  );
}
