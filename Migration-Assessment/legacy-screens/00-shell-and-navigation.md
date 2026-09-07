# 00 — The shell every screen shares

Read this before any individual screen. Most of the port's divergence from the
legacy app is here, not in the individual forms.

## The header

```
[Account Book]  [hamburger]   [ All Site  v ]              (o) CHINTAN KALATHIYA
```

- **`All Site` is a GLOBAL SCOPE SELECTOR**, present in the header of every
  single screen. It is not a per-screen filter. Everything below it — lists,
  dashboard queues, reports — is scoped to the chosen site.
- The hamburger collapses the sidebar.
- The user's name sits top right with an avatar. No visible sign-out in the
  captures; presumably behind the avatar.

**PORT GAP — this does not exist in the React app.** There is no global site
scope anywhere in `AppShell`. The Purchase Requests screen has its own per-screen
site dropdown, which is a different thing: it does not persist across screens and
nothing else honours it. This is the single largest UX divergence found so far.

## The sidebar, in the legacy order

```
Dashboard
User Master        >   (expands)
Master             v   Company / Site / Group
Supplier
Item
Purchase Request
Purchase Orders
Inward Challan
Purchase Invoice
Sales Invoice
Reports & Payments
Inventory Inward
```

The React nav groups these as Overview / Masters / Procurement / Invoicing /
Reports. That is a defensible improvement — the legacy order is flat and mixes
masters with transactions — but it IS a change, and people navigate by muscle
memory. Worth confirming with the business rather than assuming.

Note `Supplier` and `Item` sit OUTSIDE the `Master` group in the legacy nav even
though they are masters.

## The universal list layout

Every list screen is a **two-pane master-detail split**, not a full-width grid:

```
+-------------------------------------+  +---------------------------+
| [Search] [All v] [Most Recent v]    |  | <Entity> Details          |
|                                     |  |                           |
| PURPLE HEADER ROW                   |  | field    field            |
| row  (selected row is grey)         |  | field    field            |
| row                                 |  | ...                       |
+-------------------------------------+  +---------------------------+
        ~60% width                              ~40% width
```

- Clicking a row fills the right pane. **No modal.**
- The right pane doubles as the create form: the top-right primary button
  ("Add Company", "Item Inward", "Purchase Request") switches it to create mode.
- Detail fields are rendered as **disabled inputs**, not as plain text.
- Three controls above every list: a free-text `Search`, an `All` dropdown
  (status filter), and a `Most Recent` dropdown (sort).
- The purple header row is the app's signature. Column set varies.
- `Action` column holds an edit (pencil) and delete (bin) icon. Item Master adds
  a third: a clock icon for price history.

**PORT DIVERGENCE — the React app uses a full-width `DataGrid` plus a modal
`FormDialog`.** That is a real change in how the screen is worked. The legacy
pattern lets a user click down a list and read each record without opening and
closing anything; the modal pattern blocks the list while open. See `PLAN.md`.

## Conventions worth copying

- Money renders with the rupee sign and two decimals: `₹4,663,080.34`.
  Note the legacy grouping here is **Western** (`4,663,080.34`), not Indian
  lakh/crore grouping. The React app groups the Indian way (`46,63,080.34`).
  **This is a deliberate port improvement and it changes what people see.**
- Dates render `dd/mm/yyyy` in lists and `dd-mm-yyyy` in date inputs.
- Approval is a **checkbox** in lists and a **toggle switch** in detail panes.
- Boolean columns (`Active`, `IsActive`, `Approved`) are checkboxes rendered
  directly in the grid, sometimes editable inline.
