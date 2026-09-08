# 19 — Decisions we need from the business

**For:** the Account Book business owners
**From:** the migration team
**Date:** 2 September 2026

---

## Why you are reading this

We are rebuilding Account Book on newer technology. Before we write the parts that
handle money, we need decisions on **thirteen points** where the current system does
something we cannot safely guess about.

Most of these are places where the software today does something that looks like a
mistake. We have deliberately **not** corrected any of them. Correcting a rule
without asking would silently change your invoice totals, your supplier balances or
your reports — and you would have no way of knowing it had happened. So we are
asking instead.

~~**Five of these block the work.** We cannot start on invoicing — the largest and
most sensitive part of the rebuild — until questions 1 to 5 are answered.~~

**Updated 8 Sep 2026: invoicing is no longer blocked, and the purchase invoice
screen is built.** We were able to settle the calculation ourselves by running
your existing scripts rather than asking you to choose between them. Two things
follow, and the difference between them matters:

- **Nothing is waiting on you in order for us to keep building.** Purchase
  orders and purchase invoices are done; sales invoices use the same
  calculation and are next.
- **What IS waiting on you is what to do about documents already issued.**
  Questions 1, 2 and 3 are about existing data — totals that may not match their
  own lines, TDS that may not have been deducted, returns added instead of
  subtracted. Every day those go unanswered is a day more documents are added to
  whatever the answer turns out to cover.

The rest we can work around for a while, but not indefinitely.

**What we need back:** a yes/no or a choice on each. Not a written report. A
half-hour conversation would settle most of them.

**Please note:** wherever this document says the system currently gets something
wrong, that is not a criticism of anyone. These are ordinary defects of the kind
that accumulate in any system that has been running and growing for years. We are
listing them because the rebuild is the moment they can be fixed.

---

# Part 1 — The five most urgent

*(Titled "the five that block the work" until 8 Sep 2026. They no longer block the
building; three of them now decide what happens to documents already issued, and
question 3 blocks the supplier balance reports. They are still the urgent five.)*

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

## Question 2 — The Create Invoice total can be wrong in two ways at once

**This has moved on since the first draft.** We have now RUN your invoice
calculator — the actual JavaScript files from your web server, against the actual
layout of the Create Invoice page — instead of only reading it. The tool is
`Migration-Assessment/tools/calculator-harness`; anyone can run it and see the
same output.

> **This question is about INVOICES only — purchase orders are not affected.**
> Added 8 Sep 2026. We originally expected this answer to hold up purchase orders
> too. Checking the Create Purchase Order page showed it does not: that page
> loads only ONE calculator, and it has no discount, no TDS and no round-off
> anywhere on it — which are the three things the calculators disagree about. So
> a purchase order has one clear total, and we have built that screen without
> pre-empting your answer here.

> **THE PURCHASE INVOICE SCREEN IS NOW BUILT TOO, and this question is no longer
> holding up any building work.** Added 8 Sep 2026, later the same day. We were
> able to settle the arithmetic ourselves, by running your scripts rather than
> asking you to arbitrate between them, so the new screen calculates correctly —
> every line counted, discount applied, TDS deducted, adjustment added.
>
> **What we still need from you is about the invoices you have ALREADY issued,
> not about the new screen.** That is questions 3 and 4 below, and the checks in
> "We still need you to confirm it on the real screen" further down. Nothing is
> waiting on you to write code; what is waiting is knowing how many existing
> documents are affected and what you want done about them.
>
> One thing we found that you should know about regardless — see **"A rule
> nobody had written down"** immediately below.

### A rule nobody had written down

**Every invoice total your system has ever produced is rounded to a whole rupee,
and exactly 50 paise is rounded DOWN.**

We found this in the calculator while checking something else. It is not in any
document, and nobody mentioned it to us — but it is in the code, and your own
invoice list corroborates it: every total on it ends in `.00`.

Ordinary commercial rounding takes 50 paise UP. Yours takes it down, which is
always in the supplier's favour and never in yours. On a single invoice it is at
most 50 paise. Across a year of invoices it is not nothing.

**We have reproduced it exactly**, because it is how every document you have
issued was calculated and changing it quietly would be precisely the kind of
silent change this document exists to prevent. The new screen also says so on
screen, so nobody reports the missing paise as a bug.

> **Decision:** keep the rule as it is? ☐ Keep (recommended — it matches every
> invoice you have issued) ☐ Change to normal rounding (50 paise goes up) ☐ Stop
> rounding to whole rupees entirely
>
> If you change it, new invoices and old ones will round differently. That is
> fine, but it should be a decision rather than a surprise.

### What it showed

**(a) The TDS and round-off boxes are not read.** Create Invoice loads three
script files that each define a function with the same name. The last one to load
wins, and the winner is the **Purchase Order** calculator. A purchase order has no
TDS and no round-off, so those two boxes are never looked at. We put ₹500 of TDS
in and the total did not move by a rupee.

**(b) Worse: part of the invoice is missing from its own total.** The two
calculators do not just differ in their formulas — they look at **different rows
of the same table**. Lines that come with the page when you open it are built one
way; lines you add by picking an item from the list are built another. Each
calculator can see only one of the two kinds.

Our test invoice had two lines, ₹1,000 and ₹500 before tax. The correct total is
**₹1,770**. The calculator that runs produced **₹590** — the added line only. The
calculator that was overwritten would produce **₹1,180** — the other line only.
**Neither one gives ₹1,770**, and there is no ordering of the files that would.

**What this means in practice.** A saved invoice you REOPEN and re-save is at risk:
its existing lines are the kind the running calculator cannot see. A brand-new
invoice where every line was added from the item list totals correctly, apart from
the missing TDS.

### We still need you to confirm it on the real screen

We are testing the code in your repository. We cannot see which build your live
server is running, and we will not tell you your invoices are wrong on the
strength of that alone. Ten minutes:

1. Open an EXISTING purchase invoice that has more than one line.
2. Without changing anything, look at the total. Then change one quantity and
   change it back, so the page recalculates.
3. **Does the total change? Does it drop?**
4. On a new invoice, enter a TDS amount. **Does the total change?**

**Why it matters.** If confirmed, some purchase invoices were saved with a total
that does not deduct the TDS entered, and some may have been saved missing whole
lines. That affects what you owe suppliers and possibly your TDS returns. We would
need to know how many and over what period before deciding what to do.

> **Decision:** ☐ Confirmed on the live screen  ☐ Works correctly there  ☐ Not yet checked
>
> **If confirmed:** how far back do we investigate? ☐ Current FY ☐ All history
>
> **Also:** should we run a report over every stored invoice comparing the saved
> total against the sum of its own lines? That tells you the exact number of
> affected documents without anyone re-keying anything. ☐ Yes ☐ No

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

## Question 5a — Every invoice total is rounded to a whole rupee, and exactly 50 paise rounds DOWN

**What we found.** Your invoice and sales screens both finish by throwing away the
paise:

```
if the paise are 50 or fewer  ->  round DOWN to the rupee
otherwise                     ->  round UP to the rupee
```

So a total of ₹1,04,532.40 is charged as ₹1,04,532, and ₹1,04,532.60 as
₹1,04,533. **No invoice your system has ever issued has paise on it.**

**Two things to notice.**

1. This was not written down anywhere — not in our first assessment, not in any
   specification we were given. We found it by running the code. If it is
   deliberate, it needs recording. If nobody knew, that is more important.
2. **Exactly 50 paise rounds DOWN.** Normal commercial rounding takes a half up.
   Yours takes it down, every time, in the counterparty's favour and never in
   yours. On a sales invoice that is money you did not bill.

**Why it matters.** The new system will do whatever you tell it to. If we say
nothing, we will reproduce this exactly — including the half-rounds-down — because
that is what every existing document did, and matching history is the safer
default. But it should be a choice you made, not one you inherited.

**Your options.**

| Option | What it means |
|---|---|
| **A. Keep it exactly** (default if you do not choose) | Whole rupees, 50 paise rounds down. Nothing changes; new documents match old ones. |
| **B. Keep whole rupees, round 50 paise UP** | Standard commercial rounding. Differs from history by ₹1 on the exact-half cases only. |
| **C. Keep the paise** | Totals carry two decimals like every other figure in the system. Cleanest arithmetically, most different from what you issue today. |

**We recommend B** if this rounding is deliberate, and **C** if it turns out
nobody chose it. We do not recommend A, but it is the safe answer and we will
implement it without argument.

> **Decision:** ☐ A — keep exactly  ☐ B — round half up  ☐ C — keep the paise  ☐ Discuss
>
> **Also:** was the whole-rupee rounding a deliberate decision? ☐ Yes ☐ No ☐ Nobody knows

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

## Question 11 — Who should be allowed to edit, delete and APPROVE suppliers?

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

### The same question now applies to APPROVING, on the dashboard

_Added 8 September 2026, after building the dashboard's approval queues._

The dashboard has six "waiting for approval" panels, each with a tick-all box
and an Approve button. In the current system **all six are controlled by one
single permission** called Dashboard — not by the permission for the thing being
approved.

That has two effects today, and both are surprising:

- Anyone with that one Dashboard permission can approve **purchase requests,
  purchase orders, items, purchase invoices and suppliers** — even if they have
  no approval rights at all on any of those screens.
- Conversely, someone you have deliberately given "approve purchase requests" to
  **cannot** approve one from the dashboard unless they also hold the Dashboard
  permission.

We have treated this as a mistake rather than a rule, for the same reason as
above: one permission that silently grants approval over five different kinds of
document is not something anyone designed. **In the new system, approving an
item needs the item approval right, approving a supplier needs the supplier
approval right, and so on.**

**Why it matters.** There is a specific gap for **suppliers**: in the current
system there is no such thing as a "supplier approval" permission — supplier
approval only ever happened through that one Dashboard permission. So the right
exists in the new system and **nobody currently holds it**. Somebody has to be
given it before go-live, or nobody will be able to approve a supplier.

**What we need to know.** Who should be able to approve suppliers, and who
should be able to approve items? If the answer is "the same people who approve
purchase requests today", that is a fine answer and we will set it up.

> **Decision — editing/deleting suppliers:** ☐ Names: ______________________
> ☐ Leave it unrestricted as now
>
> **Decision — approving suppliers and items:** ☐ Names: ______________________
> ☐ Same people who approve purchase requests  ☐ Discuss

---

## Question 12 — Should a record open OVER the list, or BESIDE it?

**This one you can answer in two minutes, on the real screens, today.** It is not
about data. It is about how your staff work all day, and it gets more expensive
to change the longer it is left.

**How the old system works.** You click a row and the right-hand pane fills with
that record. The list stays where it is. You can click straight down it, reading
one record after another, without closing anything.

**How the new one was built.** The list is full width, and clicking Edit opens the
record in a box on top of it. Better for concentrating on one record. Worse for
looking through many, because the list is hidden while the box is open.

**Both are now in the new system, and you can switch between them.** Top right of
every screen there is a small control with two options — **Dialog** and **Side by
side**. It remembers your choice, and it is per user, so trying it does not
change anything for anyone else.

### Please try this

1. Open **Suppliers** or **Items** — something with a lot of rows.
2. Set the switch to **Side by side**. Click a row, then the next, then the next.
3. Set it to **Dialog**. Open a record, close it, open the next one.
4. Ask whoever spends the most time in these screens which one they want.

### The honest trade-off

Side by side takes about a third of the width, so the last column or two of a
wide list gets pushed off and you scroll sideways to see them. Dialog keeps the
full list width but hides it entirely while a record is open.

There is no third option that avoids both. The question is which one costs your
staff less.

**Why we are asking now.** Whichever you choose, the other is deleted. Today that
is one shared change. Once ten more screens are built on the wrong one it is ten
times the work, and by then people will have got used to it.

> **Decision:** ☐ Side by side, like the old system  ☐ Dialog  ☐ Keep both and let each user choose
>
> _(We would advise against the third. Two layouts is two of everything to test
> and support, and it leaves the question permanently open.)_

---

## Question 13 — Should uploading a spreadsheet of items approve them automatically?

**What we found.** Items have an **Approved** tick. An item added one at a time
through the form starts **not approved**. An item added by uploading a spreadsheet
is marked **approved immediately** — the current system does this, and we have kept
it.

**Why it matters.** It means the permission to upload a file is quietly a bigger
permission than the one to add an item by hand. Somebody who may add items can
approve 700 of them in one action, without anyone else looking at them. In the
current system this is partly hidden, because the item list only shows approved
items — so an upload that did not approve would appear to have done nothing at all.

**Why we kept it for now.** Changing it would mean an upload of 700 items lands
invisibly and someone then has to tick 700 boxes. That is almost certainly not what
anyone wants. But "the alternative is worse" is not the same as "this is right", so
it is worth one minute of your time.

**What we need to know.** Is bulk upload itself the approval — i.e. the person doing
it is trusted to have checked the file — or should uploaded items wait for a
separate approval like hand-entered ones do?

> **Decision:** ☐ Upload approves them, as now  ☐ Uploaded items must be approved
> separately  ☐ Discuss

---

# Summary sheet

| # | Question | Blocks work? | Decision |
|---|---|---|---|
| 1 | Invoice totals may shift by ₹0.01 | Affects ISSUED invoices | |
| 1a | **Totals are rounded to a whole rupee, 50p DOWN** — keep it? | Affects ISSUED invoices | |
| 2 | Create Invoice may be dropping TDS | Affects ISSUED invoices | |
| 3 | Purchase Returns added, not subtracted | **Yes — blocks reports** | |
| 4 | April stamped with the wrong FY | **Yes** | |
| 5 | Two reports always blank | **Yes** | |
| 6 | Should PR link to PO? | No | |
| 7 | No stock tracking | No | |
| 8 | Duplicate PO line counted once | No | |
| 9 | Over-invoicing allowed | No | |
| 10 | Deleted items resurrected on re-create | No | |
| 11 | Who can edit suppliers, and who can APPROVE suppliers and items | Before cutover | |
| 12 | Record over the list, or beside it | **Gets dearer weekly** | |
| 13 | Does uploading a spreadsheet approve the items? | No | |

**Updated 8 Sep 2026.** The invoicing rebuild is no longer waiting on these — the
purchase invoice screen is built, and it calculates correctly. What questions 1,
1a and 2 now decide is **what happens to the invoices you have already issued**,
and question 3 still blocks the supplier balance reports.

**Question 2 is still the one to act on first**, because it may affect data that
is being created right now, and every day it goes unanswered adds documents to
whatever the answer turns out to cover.

---

## Technical cross-reference

*(For the migration team, not for the business.)*

| Question here | Rule in `07-Business-Rule-Inventory.md` |
|---|---|
| 1 | D2 group, consequence (b) and (c) |
| 1a | `roundToWholeRupeeAsProduced` in `packages/domain/src/money.ts` |
| 2 | D-JS-1 |
| 3 | D7 (and `:272`, the zero-balance filter) |
| 4 | D1–D4, shared defect 4 |
| 5 | D22a, variant 3 |
| 6 | D13 |
| 7 | D26 |
| 8 | D10, grouping defect |
| 9 | D10, no clamping |
| 10 | D19 |
| 12 | `legacy-screens/PLAN.md` §1.2; `contexts/RecordLayoutContext.tsx` |
| 11 | `SESSION-HANDOFF.md` §5b decision 1 and §5p; finding C-6; `legacy-screens/01-dashboard.md` |
| 13 | `SESSION-HANDOFF.md` §5o; `modules/items/item-sheet.service.ts` `toCreateItem` |
