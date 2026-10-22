import type { ItemColumn, TemplateLayout } from "@accountmanagement/contracts";

/**
 * A purchase order WITHOUT ITS AMOUNTS (client, 22 Oct 2026: "PO with amount and
 * without amount").
 *
 * The copy for the site or the transporter: what is coming and how much of it,
 * and nothing of what it costs. Made from whichever layout is chosen, so the
 * letterhead, the parties and the terms print as they always do; the rates and
 * amounts leave the item table, and the totals, the tax summary and the amount
 * in words leave the page.
 */
const KEPT_COLUMNS: ReadonlySet<ItemColumn> = new Set(["index", "item", "hsn", "quantity", "unit"]);
const MONEY_BLOCKS = new Set(["totals", "tax-summary", "amount-in-words"]);

export function withoutAmounts(layout: TemplateLayout): TemplateLayout {
  return {
    ...layout,
    rows: layout.rows
      .map((row) => ({
        ...row,
        columns: row.columns.map((column) => ({
          ...column,
          blocks: column.blocks
            .filter((block) => !MONEY_BLOCKS.has(block.type))
            .map((block) => {
              if (block.type !== "items-table") return block;
              const columns = block.columns.filter((name) => KEPT_COLUMNS.has(name));
              return { ...block, columns: columns.length > 0 ? columns : (["item", "quantity", "unit"] as ItemColumn[]) };
            }),
        })),
      }))
      // A row that held only money — the totals beside the amount in words — goes too.
      .filter((row) => row.columns.some((column) => column.blocks.length > 0)),
  };
}

/** The choice as the print page's address carries it: `?amounts=no`. */
export const AMOUNTS_PARAM = "amounts";
