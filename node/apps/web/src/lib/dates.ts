/**
 * Today, in the form an `<input type="date">` wants.
 *
 * LOCAL PARTS, NEVER `toISOString()`. That method converts to UTC first, and
 * India is UTC+5:30 — so from 18:30 every evening it returns YESTERDAY. A
 * document dated a day early is not a display bug; it lands in the ledger, and
 * on the 1st of a month it lands in the wrong month.
 *
 * Computed on each call rather than held in a module constant, because a
 * browser tab in this application stays open for days: a constant read at load
 * time would still be offering last Tuesday's date on Friday.
 */
export function todayInput(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
