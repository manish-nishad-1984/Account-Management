import { describe, expect, it } from "vitest";
import { buildPayoutMessage, formatListDate, whatsAppUrl } from "./message";

const line = (partyName: string, amount: string, n = 1) => ({
  id: `l${n}`,
  partyId: `p${n}`,
  partyName,
  amount,
  outstandingAtSave: null,
  outstandingNow: amount,
});

const list = (overrides: Record<string, unknown> = {}) => ({
  listDate: "2026-10-05",
  title: null as string | null,
  lines: [line("Ambica Steel Traders", "125000.00", 1), line("Shree Cement", "515000.00", 2)],
  ...overrides,
});

describe("buildPayoutMessage", () => {
  it("writes the date, one numbered line per party and the total last", () => {
    expect(buildPayoutMessage(list())).toBe(
      [
        "Payout list - 05 Oct 2026",
        "1. Ambica Steel Traders - Rs 1,25,000.00",
        "2. Shree Cement - Rs 5,15,000.00",
        "Total: Rs 6,40,000.00",
      ].join("\n"),
    );
  });

  it("puts the title under the heading when there is one", () => {
    const lines = buildPayoutMessage(list({ title: "Weekly payout" })).split("\n");
    expect(lines[0]).toBe("Payout list - 05 Oct 2026");
    expect(lines[1]).toBe("Weekly payout");
    expect(lines[2]).toBe("1. Ambica Steel Traders - Rs 1,25,000.00");
  });

  it("leaves no blank line for an empty or blank title", () => {
    for (const title of [null, "", "   "]) {
      const text = buildPayoutMessage(list({ title }));
      expect(text.split("\n")).toHaveLength(4);
      expect(text).not.toContain("\n\n");
    }
  });

  it("keeps the order of the lines and numbers them from 1", () => {
    const text = buildPayoutMessage(
      list({ lines: [line("Zed", "1.00", 1), line("Alpha", "2.00", 2), line("Mid", "3.00", 3)] }),
    );
    expect(text.split("\n").slice(1, 4)).toEqual(["1. Zed - Rs 1.00", "2. Alpha - Rs 2.00", "3. Mid - Rs 3.00"]);
  });

  it("ends on the total", () => {
    const rows = buildPayoutMessage(list()).split("\n");
    expect(rows[rows.length - 1]).toMatch(/^Total: Rs /);
  });

  it("groups large amounts the Indian way", () => {
    const text = buildPayoutMessage(list({ lines: [line("Big Buyer", "40000000.00", 1)] }));
    expect(text).toContain("1. Big Buyer - Rs 4,00,00,000.00");
    expect(text).toContain("Total: Rs 4,00,00,000.00");
  });

  it("shows a part amount as chosen, not as owed", () => {
    const text = buildPayoutMessage({
      ...list(),
      lines: [{ ...line("Part Paid", "50000.00", 1), outstandingNow: "125000.00" }],
    });
    expect(text).toContain("1. Part Paid - Rs 50,000.00");
    expect(text).toContain("Total: Rs 50,000.00");
  });

  it("adds the total exactly, with paise", () => {
    const text = buildPayoutMessage(list({ lines: [line("A", "0.10", 1), line("B", "0.20", 2)] }));
    expect(text).toContain("Total: Rs 0.30");
  });

  it("pads whole and one-decimal amounts to two places", () => {
    const text = buildPayoutMessage(list({ lines: [line("A", "1500", 1), line("B", "2.5", 2)] }));
    expect(text).toContain("1. A - Rs 1,500.00");
    expect(text).toContain("2. B - Rs 2.50");
  });

  it("uses Rs on every amount and never the rupee sign", () => {
    expect(buildPayoutMessage(list())).not.toContain("\u20B9");
  });
});

describe("formatListDate", () => {
  it("reads the date off the string, so no timezone can move it", () => {
    expect(formatListDate("2026-10-05")).toBe("05 Oct 2026");
    expect(formatListDate("2026-01-01")).toBe("01 Jan 2026");
    expect(formatListDate("2026-12-31")).toBe("31 Dec 2026");
  });
});

describe("whatsAppUrl", () => {
  it("names no phone number, so WhatsApp asks who to send it to", () => {
    expect(whatsAppUrl("hello")).toBe("https://wa.me/?text=hello");
  });

  it("encodes new lines, spaces, ampersands and non-ASCII characters", () => {
    const message = buildPayoutMessage(
      list({ title: "A&B / 100% ready?", lines: [line("Sharma & Sons (\u00C9lite)", "1000.00", 1)] }),
    );
    const url = whatsAppUrl(message);

    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const query = url.slice("https://wa.me/?text=".length);
    expect(query).not.toMatch(/[\s&?/]/);
    expect(query).toContain("%0A");
    expect(query).toContain("%26");
    expect(decodeURIComponent(query)).toBe(message);
  });
});
