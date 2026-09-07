# 03 — Site Master

`/SiteMaster/SiteListView` — "Site Master". Primary action: **Add Site**.

## List

| Site Name | Contact Name | **Active** | Action |

`Active` is a checkbox rendered inside the grid. In the capture AV ENTERPRISE is
**unticked** while every other row is ticked — so **inactive sites are listed,
not hidden**.

Visible: VIRTUAL SITE, AMIDHARA GROUPS, OM SAGAR CONSTRUCTION, AV ENTERPRISE,
ONGC-KHAMBHAT, SURAT EWS-PALANPOR, BHAVNAGAR-JAIMISH, BHAVNAGAR-RAJUBHAI. The
list scrolls; 13 live sites are imported.

## Detail pane — "Site Information"

| Field |
|---|
| Site Name (full width) |
| Contact Person Name / Contact Person Phone No |
| Address (textarea, full width) |
| City / Pincode |

Sample: VIRTUAL SITE, VIRTUAL PERSON, 9898988778, "VIRTUAL LOCATION WITH 3
DIFFRENT LOCATION", Surat, 395001.

## Notes for the port

- This pane shows **one** address. Our `sites` table carries two sets — main and
  shipping (`shipping_address`, `shipping_area`, `shipping_city_id`, …). The
  detail pane does not surface the second; check the Add/Edit form before
  concluding it is unused.
- That inactive sites are still listed here is the mirror image of the purchase
  request departure: the source's PR list filters on `IsActive == true` and so
  hides the *requests* of a deactivated site, while the site itself stays
  visible on this screen. The source is inconsistent with itself; the port lists
  both.
