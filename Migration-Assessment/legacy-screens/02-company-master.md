# 02 — Company Master

`/Company/CreateCompany` — titled "Company Master". Primary action: **Add Company**.

## List

| Company Name | Gst No | Pan No | Action |

Three live companies: AV ENTERPRISE, DH PATEL, DH PATEL INFRASTRUCTURE PRIVATE
LIMITED — matching the three the importer loads.

## Detail pane — "Company Details"

Two columns:

| Left | Right |
|---|---|
| Company Name | Gst No |
| Pan No | Address |
| **Landmark** | Country |
| State | City |
| Pincode | Invoice Prefix |
| BankName | BankBranch |
| AccountNo | **Iffccode** |

Sample row: AV ENTERPRISE, 24AAOHV2497L1ZB, AAOHV2497L, "SHOP NO. 10, RIDHHI
RESIDENCY, SAY...", landmark "NA", India, GUJRAT, Surat, 394540, prefix "AV",
INDUS BANK LIMITED, KATARGMA-SURAT, 201030695046, INDB00001058.

## Port gaps

1. **`landmark` is missing from our `companies` table** — verified against the
   schema. The legacy screen shows and stores it. It needs a column and a field,
   or an explicit decision to drop it. Dropping it silently is not an option.
2. **State, City and Country render as NAMES here.** Our schema stores
   `city_id` / `state_id` / `country_id` as bare integers with no foreign key,
   because the geography lookup tables have never been extracted (assessment
   blocker 1). Until they are, our form cannot show what this one shows. **This
   is a visible regression, and it is gated on the census.**
3. `Iffccode` is the source's misspelling of IFSC. We store `ifsc_code`. The
   column name should stay corrected; the LABEL should read as the business
   expects.

`Invoice Prefix` matters more than it looks: it is what makes a document number
read `AV/...` rather than `DHP/...`. That is the same numbering machinery
`document_counters` now owns for purchase requests, and it will need a
per-company dimension when invoices land.
