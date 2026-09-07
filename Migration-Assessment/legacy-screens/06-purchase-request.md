# 06 — Purchase Request  ✅ PORTED

`/PurchaseMaster/PurchaseRequestListView` — "Purchase Request".
Primary action: **Purchase Request**.

**Live in the port at https://avfast.in/purchase-requests.**

## List

| Item Name | Date | Unit | Quantity | Status | Action |

Two rows in the capture:

| Item Name | Date | Unit | Qty | Status |
|---|---|---|---|---|
| CEMENT BAG OPC-53 JK LAKSHMI | 25/11/2025 | MTS - Metric Ton | 12.5 | ticked |
| CEMENT BAG OPC-53 ULTRATECH | 26/12/2026 | MTS - Metric Ton | 12.5 | ticked |

**The list does not show the request number.** It only appears in the detail
pane. The port shows `prNo` as the first column, which is a deliberate
improvement — the number is how a request is referred to on the phone.

## Detail pane — "PurchaseRequest Details"

| Field | Value |
|---|---|
| Purchase Request No | PR/25-26/008 |
| Item Name | CEMENT BAG OPC-53 JK LAKSHMI |
| Item Description | CEMENT |
| Unit Name / Quantity | MTS - Metric Ton / 12.5 |
| SiteName / **IsApproved** | SURAT-AURO UNIVERSITY / toggle, ON |
| Site Address | AURO UNIVERSITY GATE NO. 6, OPP. RESTRO 13 CAFE, CASA RIVA ROAD BHATPOR GIDC, OPP ONGC, ICHHAPOR, SURAT |

`PR/25-26/008` is one of the three live requests, and its quantity `12.5`
confirms quantities are genuinely fractional — hence a decimal string, never a
float, and `formatQuantity` trimming `12.50` to `12.5`.

## What the port does differently, and why

| Legacy | Port | Why |
|---|---|---|
| No PR number in the list | First column | It is the document's identity |
| Number issued when the form opens, posted back on save | Issued by the server inside the insert transaction | Two open forms took the same number, and nothing refused it |
| `Substring(11)` numbering — reissues after 010 | `document_counters` | 28 rows carry 12 distinct numbers in production |
| Approve = toggle whatever is there | Approve = set a stated value | Two approvers racing landed wherever ordering put them |
| Update reassigns `PrNo` from the body | `prNo` absent from the update contract | A client could renumber one request over another |
| INNER JOIN on ItemMaster | LEFT JOIN, falls back to free text | Requests with no catalogue item were invisible |
| Filters `site.IsActive == true` | No such filter | Deactivating a site erased its request history |

## Still missing

- **Site Address is free text here and in the port**, with a `site_address_id`
  carried as a bare integer and no FK, because the source `SiteAddress` table has
  not been extracted. Same reasoning as geography.
- No bulk-approve UI yet on this screen; the dashboard queue is where the legacy
  app does it, and the endpoint exists.
