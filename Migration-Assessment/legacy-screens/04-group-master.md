# 04 — Group (site groups)

`/SiteMaster/CreateGroup` — breadcrumb "CreateGroup". Primary action: **Add Group**.

## List

| Group Name | Action |

Long and scrolling: PROJECT OFFICE, ROAD-GATE, PUMP HOUSE, INFRA, JMR,
COLONY-OFFICE, LIGHT POLE, OFFICE, SAIL-SEA, CC, GOLF CLUB, NET. POL,
MHR-PARLEPOINT … 35 live groups are imported.

## Detail pane — "Group Details"

| Field | Value in the capture |
|---|---|
| Group Name | ROAD-GATE |
| Site Name | SURAT-AURO UNIVERSITY — a group belongs to ONE site |
| **Multiple Group Address** | a bordered, scrollable REPEATER of Group Address textareas |

## Notes for the port

- "Multiple Group Address" is a one-to-many. It is `site_group_addresses` in our
  schema, and it was the largest modelling decision in the masters work
  (SESSION-HANDOFF section 6). This screen confirms the shape: a group has a
  name, exactly one site, and N free-text addresses.
- A group's addresses are what the "Group Address" panel on a purchase order
  picks from — see `08-create-purchase-order.md`.
- **This is where the trailing-CRLF problem lives.** Four groups carry a trailing
  carriage return in their name (OFFICE, COMMUNITY HALL, SARDARNAGAR,
  HOME-ROYAL), and 187 supplier invoices reference OFFICE by string match. On
  this screen they look identical to clean ones. The importer refuses to trim
  them silently and reports each instead.
