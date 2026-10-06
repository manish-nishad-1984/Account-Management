import type { PayoutListDetail } from "@accountmanagement/contracts";
import { buildImageRows, type ImageRow } from "./imageModel";

/**
 * Draws a payout list as a PNG, in the browser (client request, 6 Oct 2026).
 *
 * A canvas, not a screenshot library: the picture is a table of names and
 * figures, which a few `fillText` calls draw exactly, and nothing has to be
 * installed or shipped to draw it. Nothing is stored on the server - the image
 * is made when it is sent, from the saved list, and handed to WhatsApp.
 *
 * The font stack is the system's, so the picture looks like the rest of the app
 * on the machine that makes it; WhatsApp only ever sees pixels.
 */

const WIDTH = 900;
const SCALE = 2;
const PAD = 32;
const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const HEIGHTS: Record<ImageRow["kind"], number> = {
  title: 56,
  subtitle: 30,
  party: 40,
  bill: 28,
  total: 60,
};

export function renderPayoutImage(
  detail: Pick<PayoutListDetail, "listDate" | "title" | "lines">,
): Promise<Blob> {
  const rows = buildImageRows(detail);
  const height = PAD * 2 + rows.reduce((sum, row) => sum + HEIGHTS[row.kind], 0);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("This browser cannot draw the list as an image"));
  context.scale(SCALE, SCALE);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WIDTH, height);

  const left = PAD;
  const right = WIDTH - PAD;
  let y = PAD;

  const text = (value: string, x: number, baseline: number, font: string, color: string, align: CanvasTextAlign) => {
    context.font = font;
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, baseline);
  };

  /** Cuts a long name to the room it has, with an ellipsis, rather than running into the figure. */
  const fit = (value: string, font: string, room: number) => {
    context.font = font;
    if (context.measureText(value).width <= room) return value;
    let cut = value;
    while (cut.length > 1 && context.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
    return `${cut}…`;
  };

  for (const row of rows) {
    const h = HEIGHTS[row.kind];
    switch (row.kind) {
      case "title":
        text(row.left, left, y + 34, `700 26px ${FONT}`, "#0f172a", "left");
        text(row.right, right, y + 34, `500 18px ${FONT}`, "#475569", "right");
        context.fillStyle = "#cbd5e1";
        context.fillRect(left, y + h - 8, right - left, 2);
        break;
      case "subtitle":
        text(row.left, left, y + 20, `500 17px ${FONT}`, "#475569", "left");
        break;
      case "party": {
        const font = `600 19px ${FONT}`;
        const label = `${row.index}.  ${row.left}`;
        const amountFont = `700 19px ${FONT}`;
        context.font = amountFont;
        const room = right - left - context.measureText(row.right).width - 24;
        text(fit(label, font, room), left, y + 28, font, "#0f172a", "left");
        text(row.right, right, y + 28, amountFont, "#0f172a", "right");
        break;
      }
      case "bill": {
        const font = `400 15px ${FONT}`;
        context.font = font;
        const room = right - left - 28 - context.measureText(row.right).width - 24;
        text(fit(row.left, font, room), left + 28, y + 19, font, "#64748b", "left");
        text(row.right, right, y + 19, font, "#64748b", "right");
        break;
      }
      case "total":
        context.fillStyle = "#f1f5f9";
        context.fillRect(left - 12, y + 6, right - left + 24, h - 12);
        context.fillStyle = "#0f172a";
        context.fillRect(left - 12, y + 6, right - left + 24, 2);
        text(row.left, left, y + 40, `600 19px ${FONT}`, "#334155", "left");
        text(row.right, right, y + 40, `700 24px ${FONT}`, "#0f172a", "right");
        break;
    }
    y += h;
  }

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make the image"))), "image/png"),
  );
}
