# 19 — Decisions we need from the business

**For:** the Account Book business owners
**From:** the migration team
**Date:** 2 September 2026

---

## Why you are reading this

We are rebuilding Account Book on newer technology. Before we write the parts that
handle money, we need decisions on **eleven points** where the current system does
something we cannot safely guess about.

Most of these are places where the software today does something that looks like a
mistake. We have deliberately **not** corrected any of them. Correcting a rule
without asking would silently change your invoice totals, your supplier balances or
your reports — and you would have no way of knowing it had happened. So we are
asking instead.

**Five of these block the work.** We cannot start on invoicing — the largest and
most sensitive part of the rebuild — until questions 1 to 5 are answered. The rest
we can work around for a while, but not indefinitely.

**What we need back:** a yes/no or a choice on each. Not a written report. A
half-hour conversation would settle most of them.

**Please note:** wherever this document says the system currently gets something
wrong, that is not a criticism of anyone. These are ordinary defects of the kind
that accumulate in any system that has been running and growing for years. We are
listing them because the rebuild is the moment they can be fixed.

---

# Part 1 — The five that block the work

## Question 1 — Invoice totals may change by one paisa

**What we found.** All of your invoice arithmetic — subtotals, GST, discount, TDS,
round-off — is calculated inside the web browser, not on the server. The server
stores whatever number the browser sends it, without checking it.

When we rebuild, the calculation moves to the server and uses proper decimal
arithmetic. Browsers use a kind of arithmetic that is very slightly imprecise for
money. The new system will therefore produce a total that differs by **up to one
paisa (₹0.01)** on some historical invoices.

**Why it matters.** If you re-print an old invoice from the new system, it might
show ₹1,04,532.18 where the original showed ₹1,04,532.17. For a GST invoice that
has already been filed, that is a discrepancy someone could question.

**Your options.**

| Option | What it means |
|---|---|
| **A. Freeze history** (recommended) | Historical invoices keep the exact total they were issued with, forever. New invoices use the correct server-side calculation. The two are allowed to differ. |
| **B. Recalculate everything** | Every historical invoice is recomputed. Totals become internally consistent, but some filed invoices no longer match what you filed. |

**We recommend A.** An issued invoice is a legal record of what you charged. It
should not change because the software was rebuilt.

> **Decision:** ☐ A — freeze history  ☐ B — recalculate  ☐ Discuss

---

## Question 2 — Purchase invoices may have been missing TDS and round-off

**What we found.** On the **Create Invoice** screen specifically, we found what
looks like a collision between two parts of the software. The Purchase Order
calculation appears to overwrite the Invoice calculation. Purchase Orders have no
TDS and no round-off — so on that screen, **the TDS and round-off boxes may be
ignored entirely**, even when you fill them in.

**We have not been able to confirm this against your live system.** It is what the
code says should happen. It needs ten minutes of checking by someone who uses the
screen daily.

**Why it matters.** If it is confirmed, then some purchase invoices have been saved
with a total that does not deduct the TDS that was entered. That affects supplier
balances and possibly TDS returns. We would need to establish how many invoices and
over what period before deciding what to do about it.

**What we need.** Someone who uses Create Invoice to do this, today if possible:

1. Create a test purchase invoice.
2. Enter a TDS amount and a round-off amount.
3. Check whether the final total actually changes when you do.

Then tell us: **does entering TDS change the total, yes or no?**

> **Decision:** ☐ Confirmed — TDS is ignored  ☐ Works correctly  ☐ Not yet checked
>
> **If confirmed:** how far back do we need to investigate? ☐ Current FY ☐ All history

---

## Question 3 — Purchase Returns are being added to supplier balances instead of subtracted

**What we found.** When the system calculates what you owe a supplier, a **Purchase
Return** and a **Credit Note** are **added** to the balance rather than subtracted.

**Why it matters.** For any supplier you have returned goods to, the outstanding
balance shown on the payout screen is **too high by twice the value of the return**.
Return ₹50,000 of material and the balance is ₹1,00,000 higher than it should be.
This is silent, and it compounds over time.

There is a second, related issue: suppliers whose balance is exactly zero are
**hidden from the list entirely**. A fully settled supplier disappears rather than
showing as settled.

**Your options.**

| Option | What it means |
|---|---|
| **A. Fix it in the new system only** (recommended) | New system shows correct balances. Old reports you have already issued stay as they were. |
| **B. Fix it and restate** | We also correct the historical figures, and you reissue any supplier statements that were wrong. |
| **C. Keep current behaviour** | Only if these figures are already being corrected manually somewhere downstream and changing them would break that process. |

**We recommend A**, unless these balances are used directly for payment decisions —
in which case this is urgent and should be fixed in the current system now, not in
a year's time.

> **Decision:** ☐ A  ☐ B  ☐ C  ☐ Discuss
>
> **Also:** are these payout balances used to decide actual payments? ☐ Yes ☐ No

---

## Question 4 — Every April is stamped with the wrong financial year

**What we found.** The Indian financial year starts on 1 April. The system's rule
says the new year starts on **1 May**. So every document created during **April** —
invoices, purchase orders, purchase requests — carries the **previous** year's
financial-year label.

An invoice raised on 10 April 2025 is numbered `ABC/24-25/...` when it should be
`ABC/25-26/...`.

**Why it matters.** Your document numbering and your year-wise reports are
affected for one month every year. We have measured it precisely: **90 days across
2024–2026 are labelled wrongly, all of them in April.**

**Your options.**

| Option | What it means |
|---|---|
| **A. Correct going forward, leave history alone** (recommended) | From cutover, April documents get the right year. Existing documents keep the numbers they were issued with. |
| **B. Correct retrospectively** | We relabel historical documents. This changes invoice numbers that have already been sent to suppliers and customers, and filed. |

**We strongly recommend A.** An invoice number that has been issued should never
change. Option B would mean your records no longer match your suppliers' records.

> **Decision:** ☐ A — fix forward only  ☐ B — restate history  ☐ Discuss

---

## Question 5 — Two report exports have been returning blank for every year

**What we found.** Two specific exports — the **Invoice Details PDF report** and the
**Invoice Details by Supplier Excel export** — return **no rows for any year you
select**. Not an error message: they report it as a period with no transactions.

This is caused by a date-handling defect that makes the report search the year 25 AD
instead of 2025.

**Why it matters.** Anyone who ran these reports and saw nothing may have concluded
there were genuinely no transactions in that period.

**What we need to know.** Does anyone actually use these two exports? If yes, has
anyone made a decision based on one of them coming back empty?

> **Decision:** ☐ Nobody uses them — low priority  ☐ In use — fix and notify users
> ☐ In use, and a decision was made on a blank result — needs investigating

---

# Part 2 — Six that shape what we build

## Question 6 — Should Purchase Requests link to Purchase Orders?

**What we found.** There is **no connection at all** between a Purchase Request and
a Purchase Order in the system. No field links them. If your team converts a request
into an order, they are re-typing it by hand.

**What we need to know.** Is that how it actually works, or do you expect the system
to carry a request through into an order?

This one materially changes what we build. If you want the link, now is the time —
adding it later is significantly more work.

> **Decision:** ☐ Manual re-entry is correct  ☐ We want PR → PO conversion
> ☐ Discuss

---

## Question 7 — The system does not track stock on hand

**What we found.** Nothing in the system calculates stock in hand. Goods received
and goods sold are recorded in **two separate tables that are never reconciled
against each other**. Raising a sales invoice does **not** reduce stock; recording
an inward does **not** increase it.

**Why it matters.** If anyone believes the system knows your current stock levels,
that belief is mistaken. We want to be certain this is understood rather than
assumed, because it is the kind of gap that only becomes visible at stock-take.

**What we need to know.** Is stock tracked elsewhere — a spreadsheet, a separate
system, physical registers? And should the new system track it?

> **Decision:** ☐ Understood, tracked elsewhere  ☐ We want real stock tracking in
> the new system  ☐ Discuss

Note: real stock tracking is a **significant** addition to scope, not a small
feature. If you want it, we should plan it as its own phase.

---

## Question 8 — The same item twice on one Purchase Order is counted once

**What we found.** If a Purchase Order lists the **same item twice with the same
quantity** — say two lines of 100 bags of cement — the system treats them as one
line. The ordered quantity is then **under-reported by half**: it shows 100 ordered
when 200 were ordered.

**What we need to know.** Does this happen in practice? Some businesses deliberately
put the same item on separate lines for different delivery dates or sites.

> **Decision:** ☐ Never happens — low priority  ☐ Happens — must be fixed
> ☐ Not sure, please check the data

---

## Question 9 — Over-invoicing against a Purchase Order is allowed

**What we found.** If you order 100 units and a supplier invoices you for 120, the
system accepts it and shows a **pending quantity of minus 20**. There is no warning
and no block.

**What we need to know.** Should the new system block over-invoicing, warn about it,
or continue to allow it silently?

Some businesses need to allow it — part deliveries, rate revisions, agreed
overages. We do not want to impose a rule you would have to work around.

> **Decision:** ☐ Block it  ☐ Warn but allow (recommended)  ☐ Allow silently, as now

---

## Question 10 — Deleting an item and re-creating it brings the old one back

**What we found.** When you delete an item or a supplier, it is hidden rather than
actually removed. If you later create a new one **with the same name**, the system
does not create a new record — it **restores the old hidden one**, along with every
historical invoice that was linked to it.

**Why it matters.** If you deleted "Cement OPC 53" and later added a new "Cement OPC
53" from a different supplier at a different rate, the new item silently inherits
the old item's entire history.

**What we need to know.** Is this deliberate — a way of undoing an accidental
deletion — or is it unwanted?

> **Decision:** ☐ Deliberate, keep it  ☐ Unwanted, create a genuinely new record
> ☐ Discuss

---

## Question 11 — Who should be allowed to edit and delete suppliers?

**What we found.** In the current system, **editing and deleting a supplier is not
permission-checked at all**. Anyone who can log in can change or delete any
supplier, regardless of what their permission boxes say.

We have treated this as a security gap rather than a business rule, and the new
system **does** check permissions here. That is a deliberate departure from current
behaviour, and it has a practical consequence.

**Why it matters.** Whoever maintains suppliers today needs the supplier **Edit**
and **Delete** boxes ticked on their user account **before cutover**. Otherwise they
will lose the ability to do their job on day one.

**What we need to know.** Who maintains suppliers? We will check their permissions
are set correctly before go-live.

> **Decision:** ☐ Names: ______________________  ☐ Leave it unrestricted as now

---

# Summary sheet

| # | Question | Blocks work? | Decision |
|---|---|---|---|
| 1 | Invoice totals may shift by ₹0.01 | **Yes** | |
| 2 | Create Invoice may be dropping TDS | **Yes** | |
| 3 | Purchase Returns added, not subtracted | **Yes** | |
| 4 | April stamped with the wrong FY | **Yes** | |
| 5 | Two reports always blank | **Yes** | |
| 6 | Should PR link to PO? | No | |
| 7 | No stock tracking | No | |
| 8 | Duplicate PO line counted once | No | |
| 9 | Over-invoicing allowed | No | |
| 10 | Deleted items resurrected on re-create | No | |
| 11 | Who can edit suppliers | Before cutover | |

**The five blocking questions have roughly a 2–4 week turnaround in our experience,
and nothing about the invoicing rebuild can start until they are settled.** Question
2 is the one to act on first, because it may affect data that is being created right
now.

---

## Technical cross-reference

*(For the migration team, not for the business.)*

| Question here | Rule in `07-Business-Rule-Inventory.md` |
|---|---|
| 1 | D2 group, consequence (b) and (c) |
| 2 | D-JS-1 |
| 3 | D7 (and `:272`, the zero-balance filter) |
| 4 | D1–D4, shared defect 4 |
| 5 | D22a, variant 3 |
| 6 | D13 |
| 7 | D26 |
| 8 | D10, grouping defect |
| 9 | D10, no clamping |
| 10 | D19 |
| 11 | `SESSION-HANDOFF.md` §5b decision 1; finding C-6 |
