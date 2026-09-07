# Legacy screen reference

What the ASP.NET app at `avinfraones.co.in` actually looks like, screen by
screen, captured from screenshots taken on 7 Sep 2026.

**This is the specification the React port is measured against.** The .NET code
says what the system *does*; these say what the people using it *see*, which is
the part that has to survive a migration intact. Where the port deviates
deliberately, the deviation is recorded in the file for that screen rather than
discovered later by a user.

## Drop the screenshots in here

The images live in the conversation, not on disk, so they could not be written
out automatically. Save them here with these exact names and they will sit
beside their spec:

| Save as | Screen |
|---|---|
| `02-company-master.png` | Company Master |
| `03-site-master.png` | Site Master |
| `04-group-master.png` | Group (site groups) |
| `05-item-master.png` | Item Master |
| `06-purchase-request.png` | Purchase Request |
| `07-purchase-orders.png` | Purchase Orders list |
| `08-create-purchase-order.png` | Create Purchase Order |
| `09-inward-challan-detail.png` | Inward Challan, viewing a row |
| `09-inward-challan-create.png` | Inward Challan, create panel |
| `10-purchase-invoice.png` | Purchase Invoice list |
| `11-create-purchase-invoice.png` | Create Invoice |
| `12-sales-invoice.png` | Sales Invoice list |
| `13-create-sales-invoice.png` | Create Sales Invoice |
| `14-reports-and-payments.png` | Reports and Payments |
| `15-inventory-inward-create.png` | Inventory Inward, create panel |
| `15-inventory-inward-detail.png` | Inventory Inward, viewing a row |
| `01-dashboard.png` | Dashboard |

## Files

| File | Covers |
|---|---|
| `00-shell-and-navigation.md` | The chrome every screen shares — read this first |
| `01-dashboard.md` | Six approval queues |
| `02-company-master.md` … `05-item-master.md` | Masters |
| `06-purchase-request.md` | **Ported.** Live at `/purchase-requests` |
| `07-purchase-orders.md`, `08-create-purchase-order.md` | Purchase orders |
| `09-inward-challan.md` | Goods inward, with file upload |
| `10-purchase-invoice.md`, `11-create-purchase-invoice.md` | **The risk centre** |
| `12-sales-invoice.md`, `13-create-sales-invoice.md` | Sales |
| `14-reports-and-payments.md` | Ledger, payouts, exports |
| `15-inventory-inward.md` | The smallest transaction screen |
| `PLAN.md` | **What to build, in what order, and why** |

## A note on the hostname

These screenshots are from **`avinfraones.co.in`**. The deployment work has been
against **`avfast.in`**. Both appear to serve the same ASP.NET application. Worth
confirming which is canonical before anything is switched off.
