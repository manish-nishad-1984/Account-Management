import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { financialYear, invoiceTotal, purchaseOrderTotal } from "@accountmanagement/domain";
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InMemoryUserRepository, UserRepository } from "./user.repository";
import { ENV, type Env } from "../../config/env";
import { DATABASE, type Database } from "../../db/database";
import {
  companies,
  documentCounters,
  forms,
  items,
  purchaseInvoiceItems,
  purchaseInvoices,
  salesInvoiceItems,
  salesInvoices,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequests,
  inventoryInward,
  inwardChallans,
  inwardChallanDocuments,
  siteGroupAddresses,
  siteGroupSites,
  siteGroups,
  sites,
  suppliers,
  units,
  userCompanies,
  userFormPermissions,
  users,
  userSites,
} from "../../db/schema";

const DEV_PASSWORD = "DevPassword1";

/**
 * Seeds data so the app can be exercised locally.
 *
 * Development only. Passwords are seeded as LEGACY PLAINTEXT on purpose, so that
 * signing in exercises the real C-1 migration path rather than a shortcut.
 *
 * Volumes are deliberately past one page (30 companies, 45 sites, 41 users) so
 * that paging, sorting and search get exercised by hand and not only by tests.
 */
@Injectable()
export class DevSeed implements OnModuleInit {
  private readonly logger = new Logger(DevSeed.name);

  constructor(
    private readonly repository: UserRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(DATABASE) private readonly db: Database | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV !== "development") {
      return;
    }

    if (this.db) {
      await this.seedDatabase(this.db);
      return;
    }

    if (this.repository instanceof InMemoryUserRepository) {
      this.repository.seed({
        id: "00000000-0000-0000-0000-000000000001",
        userName: "devuser",
        isActive: true,
        password: DEV_PASSWORD,
        permissions: ["invoice.view", "invoice.approve", "user.view", "user.edit"],
        siteIds: [],
        companyIds: [],
      });
      this.logger.warn("Seeded in-memory dev user 'devuser'");
    }
  }

  private async seedDatabase(db: Database): Promise<void> {
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) {
      return;
    }

    if (this.env.SEED_SNAPSHOT) {
      await this.seedFromSnapshot(db, this.env.SEED_SNAPSHOT);
      return;
    }

    /**
     * Invoice prefixes, made UNIQUE across the seeded companies.
     *
     * Three-letter initials collide: of 30 companies, "Ambica Buildcon" and
     * "Anand Buildcon" both give AB, and three separate firms give SC. The
     * prefix leads every purchase order and sales invoice NUMBER, so a collision
     * puts `AB/26-27/001` on screen twice for two different companies — the
     * sequence is per company and perfectly correct, and it reads as though
     * numbering were broken. That is the failure mode this project keeps
     * meeting: right behaviour, misleading data.
     *
     * Production prefixes are real and typed by the business, so this is a
     * property of the SEED and not of the system. Fixed here rather than
     * explained away, because a local screen that looks wrong costs somebody an
     * afternoon.
     */
    const companyPrefixes = uniquePrefixes(COMPANY_NAMES);

    const insertedCompanies = await db
      .insert(companies)
      .values(
        COMPANY_NAMES.map((name, i) => ({
          name,
          invoicePrefix: companyPrefixes[i]!,
          // Format-shaped, not real: 2-digit state code, 10-character PAN,
          // entity digit, "Z", check character.
          gstNo: "24" + panFor(i) + "1Z" + GST_CHECK[i % GST_CHECK.length],
          panNo: panFor(i),
          address: 100 + i + ", " + AREAS[i % AREAS.length] + " Road",
          area: AREAS[i % AREAS.length]!,
          cityId: 1 + (i % 5),
          stateId: 24,
          countryId: 1,
          pincode: String(380001 + i),
          bankName: BANKS[i % BANKS.length]!,
          bankBranch: AREAS[i % AREAS.length]!,
          accountNo: String(50100000000000 + i),
          ifscCode: BANK_CODES[i % BANK_CODES.length] + "0" + String(1000 + i),
        })),
      )
      .returning({ id: companies.id, name: companies.name, invoicePrefix: companies.invoicePrefix });

    const insertedSites = await db
      .insert(sites)
      .values(
        SITE_NAMES.map((name, i) => ({
          name,
          companyId: insertedCompanies[i % insertedCompanies.length]!.id,
          isActive: i % 9 !== 0,
          contactPersonName:
            FIRST_NAMES[i % FIRST_NAMES.length] + " " + LAST_NAMES[i % LAST_NAMES.length],
          contactPersonPhoneNo: "97" + String(20000000 + i),
          address: "Plot " + (10 + i) + ", " + AREAS[i % AREAS.length],
          area: AREAS[i % AREAS.length]!,
          cityId: 1 + (i % 5),
          stateId: 24,
          countryId: 1,
          pincode: String(380001 + i),
        })),
      )
      .returning({ id: sites.id, name: sites.name });

    // Groups own their sites and their addresses independently — the shape SQL
    // Server stores as a single cross-product table.
    const insertedGroups = await db
      .insert(siteGroups)
      .values(GROUP_NAMES.map((name) => ({ name })))
      .returning({ id: siteGroups.id, name: siteGroups.name });

    await db.insert(siteGroupSites).values(
      insertedGroups.flatMap((group, index) =>
        insertedSites
          .filter((_site, siteIndex) => siteIndex % insertedGroups.length === index)
          .slice(0, 2 + (index % 4))
          .map((site) => ({ groupId: group.id, siteId: site.id })),
      ),
    );

    await db.insert(siteGroupAddresses).values(
      insertedGroups.flatMap((group, index) =>
        Array.from({ length: 1 + (index % 3) }, (_unused, a) => ({
          groupId: group.id,
          address: group.name + " depot " + (a + 1) + ", " + AREAS[(index + a) % AREAS.length],
        })),
      ),
    );

    /**
     * Form names match the .NET `[FormPermissionAttribute]` strings exactly —
     * "Company-View", "Site-View", "Group-View" — because the permission subject is
     * derived from the form name. Getting these wrong means the migrated `Form`
     * rows grant nothing at all.
     */
    await db.insert(forms).values([
      { id: 1, formName: "User", controller: "User", formGroup: "Masters", isActive: true },
      /**
       * "Purchase  Invoice" — TWO SPACES, copied from production byte for byte.
       *
       * It read "Supplier Invoice" until 8 Sep 2026, which slugs to
       * `supplier-invoice` — so every call from the new screen would have 403'd
       * the moment it stopped being a placeholder. Same defect as the purchase
       * order row had, found the same way, this time BEFORE the deploy rather
       * than from a live 403.
       *
       * The double space is deliberate and must not be tidied. Production's
       * ACTIVE row really is `Purchase  Invoice` (id 9), so seeding the exact
       * string is what makes local and production derive the same subject. It
       * collapses to `purchase-invoice` because `slug()` replaces RUNS of
       * non-alphanumerics — which means this row also pins that behaviour, and
       * "fixing" the space here would hide a regression in `slug` rather than
       * prevent one.
       *
       * SINGULAR, where purchase orders are PLURAL. Each matches its own active
       * production row; neither is a house style to copy.
       */
      { id: 2, formName: "Purchase  Invoice", controller: "InvoiceMaster", formGroup: "Invoicing", isActive: true },
      /**
       * "Purchase Orders" — PLURAL, matching the only ACTIVE row in production.
       *
       * Production carries three rows for this screen: "Purchase Order" (id 10,
       * INACTIVE), "Create PurchaseOrder" (id 12, INACTIVE) and "Purchase Orders"
       * (id 14, active). The permission builder filters on is_active, so only the
       * plural ever reaches a token. Seeding the singular here made development
       * disagree with production and the screen 403d on its first live call.
       */
      { id: 3, formName: "Purchase Orders", controller: "PurchaseMaster", formGroup: "Purchase", isActive: true },
      { id: 4, formName: "Company", formGroup: "Masters", isActive: true },
      { id: 5, formName: "Site", formGroup: "Masters", isActive: true },
      { id: 6, formName: "Group", formGroup: "Masters", isActive: true },
      { id: 7, formName: "Supplier", formGroup: "Masters", isActive: true },
      { id: 8, formName: "Item", formGroup: "Masters", isActive: true },
      /**
       * "Purchase Request" — the NAME matters. The permission subject is derived
       * from the form name, so this row is what makes `purchase-request.view`
       * exist at all. `PurchaseMaster` also serves purchase orders, which is
       * precisely why the subject cannot come from the controller.
       */
      { id: 9, formName: "Purchase Request", controller: "PurchaseMaster", formGroup: "Purchase", isActive: true },
      /**
       * "Inventory Inward". The controller is `Sales` in the source — inventory
       * inward lives inside `SalesRepo.cs` — which is exactly why the subject
       * comes from the form name and not from there.
       */
      { id: 10, formName: "Inventory Inward", controller: "Sales", formGroup: "Purchase", isActive: true },
      /** "Inward Challan". The controller is spelled `ItemInWord` in the source. */
      { id: 11, formName: "Inward Challan", controller: "ItemInWord", formGroup: "Purchase", isActive: true },
      /**
       * "Sales Invoice" — production id 27, active, controller `Sales`.
       *
       * The controller is the reason the subject cannot come from it: `Sales`
       * ALSO serves Inventory Inward (id 10 here, id 29 in production), so a
       * controller-derived subject would collapse two unrelated screens into one
       * permission — the same collision that put Group and Site together.
       *
       * Singular, like the purchase invoice row and unlike purchase orders.
       * Each matches its own active production row.
       */
      { id: 12, formName: "Sales Invoice", controller: "Sales", formGroup: "Invoicing", isActive: true },
    ]);

    // Units first: items reference them, and the foreign key is real.
    const insertedUnits = await db
      .insert(units)
      .values(UNIT_NAMES.map((name) => ({ name })))
      .returning({ id: units.id, name: units.name });

    const insertedSuppliers = await db.insert(suppliers).values(
      SUPPLIER_NAMES.map((name, i) => ({
        name,
        mobile: "9" + String(700000000 + i * 137),
        email: name.toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@example.com",
        gstNo: "24" + panFor(i + 40) + "1Z" + GST_CHECK[i % GST_CHECK.length],
        buildingName: "Unit " + (i + 1) + ", " + AREAS[i % AREAS.length] + " Complex",
        area: AREAS[i % AREAS.length]!,
        cityId: 1 + (i % 5),
        stateId: 24,
        pincode: String(380001 + i * 3),
        bankName: BANKS[i % BANKS.length]!,
        bankBranch: AREAS[(i + 2) % AREAS.length]!,
        accountNo: String(50200000000000 + i),
        ifscCode: BANK_CODES[i % BANK_CODES.length] + "0" + String(2000 + i),
        // A third unapproved, so the flag is visible on the grid rather than
        // being a column that is always the same.
        isApproved: i % 3 !== 0,
        // Money is a STRING all the way through — see the note in fields.ts.
        openingBalance: (i % 4 === 0 ? null : String(12500 + i * 1375) + ".00") as string | null,
        openingBalanceDate: i % 4 === 0 ? null : new Date("2025-04-01T00:00:00Z"),
      })),
    ).returning({ id: suppliers.id });

    const insertedItems = await db
      .insert(items)
      .values(
      ITEM_NAMES.map((name, i) => {
        const withGst = i % 4 !== 0;
        const price = String(150 + i * 37) + ".00";
        const percent = GST_RATES[i % GST_RATES.length]!;
        return {
          name,
          unitId: insertedUnits[i % insertedUnits.length]!.id,
          pricePerUnit: price,
          isWithGst: withGst,
          /**
           * The GST amount is seeded as a plain percentage of the price, and that
           * is a seed convenience rather than a ruling. Which of the three jQuery
           * calculators is correct is still an open business question (assessment
           * finding B-2, `07-Business-Rule-Inventory.md`), and the API stores what
           * it is given rather than arbitrating.
           */
          gstPercent: withGst ? percent : null,
          gstAmount: withGst ? ((Number(price) * Number(percent)) / 100).toFixed(2) : null,
          hsnCode: String(3917 + (i % 40) * 7).padStart(4, "0"),
          isApproved: i % 5 !== 0,
        };
      }),
      )
      .returning({ id: items.id, name: items.name, unitId: items.unitId });

    // One administrator plus 40 others, so the grid has several pages to walk.
    const seeded = await db
      .insert(users)
      .values([
        {
          firstName: "Dev",
          lastName: "User",
          email: "devuser@example.com",
          phoneNo: "9000000000",
          userName: "devuser",
          password: DEV_PASSWORD,
          passwordIsLegacy: true,
        },
        ...Array.from({ length: 40 }, (_, i) => ({
          firstName: FIRST_NAMES[i % FIRST_NAMES.length]!,
          lastName: LAST_NAMES[i % LAST_NAMES.length]!,
          email: "user" + String(i + 1).padStart(2, "0") + "@example.com",
          phoneNo: "98" + String(10000000 + i),
          userName: "user" + String(i + 1).padStart(2, "0"),
          password: DEV_PASSWORD,
          // Two thirds still on plaintext, so the "Legacy password" badge is visible.
          passwordIsLegacy: i % 3 !== 0,
          isActive: i % 7 !== 0,
        })),
      ])
      .returning({ id: users.id, userName: users.userName });

    const admin = seeded.find((u) => u.userName === "devuser")!;
    await db.insert(userFormPermissions).values([
      { userId: admin.id, formId: 1, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true },
      /**
       * Purchase Invoice, with all five rights.
       *
       * View + edit + approve was enough while the screen was a placeholder. It
       * now has a list, a form, single approval, bulk approval and a delete, and
       * every one of those is guarded — so the missing add and delete would have
       * been two 403s on a screen whose other buttons worked.
       */
      {
        userId: admin.id,
        formId: 2,
        isViewAllow: true,
        isAddAllow: true,
        isEditAllow: true,
        isDeleteAllow: true,
        isApproved: true,
      },
      /**
       * Purchase Order, with all five rights.
       *
       * View-only while the screen was a placeholder. The module now has a list,
       * a form, single approval and bulk approval, and every one of those is
       * guarded — so without these grants the screen 403s on its first call,
       * which is the §5f failure mode the subject note in
       * `purchase-orders.controller.ts` warns about.
       */
      {
        userId: admin.id,
        formId: 3,
        isViewAllow: true,
        isAddAllow: true,
        isEditAllow: true,
        isDeleteAllow: true,
        isApproved: true,
      },
      // Company and Site each have View/Add/Edit/Delete attributes in the .NET code.
      { userId: admin.id, formId: 4, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true },
      { userId: admin.id, formId: 5, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true },
      /**
       * Group gets VIEW ONLY, and that is not an oversight.
       *
       * `Group-View` is the only group permission that exists anywhere in the .NET
       * solution — there is no Group-Add, Group-Edit or Group-Delete attribute, so
       * creating and deleting site groups is unauthorised in the app today
       * (assessment finding C-6). Seeding rights that nobody can actually hold
       * would paper over that, so the Site Groups grid shows no row actions.
       */
      { userId: admin.id, formId: 6, isViewAllow: true },
      /**
       * Supplier gets all four rights, though only `Supplier-View` and
       * `Supplier-Add` exist as attributes in the .NET code.
       *
       * `UpdateSupplierDetails` and `DeleteSupplierDetails` carry NO
       * `[FormPermissionAttribute]` at all, so they are reachable by anyone —
       * assessment finding C-6, the hole the default-deny guard exists to close,
       * not a business rule. The port guards both, which means the rights have to
       * be grantable, and the dev administrator holds them.
       */
      {
        userId: admin.id,
        formId: 7,
        isViewAllow: true,
        isAddAllow: true,
        isEditAllow: true,
        isDeleteAllow: true,
        /**
         * APPROVE, which nothing in the source reads for Supplier.
         *
         * Every other approvable form has a view that checks its own right —
         * `FormName == "Item" && a.IsApproved` at `ItemMasterController.cs:97`,
         * and the same shape for Purchase Request, Inward Challan, Purchase
         * Order and Purchase Invoice. The Supplier views check only Add, Edit
         * and Delete. Supplier approval happens on the DASHBOARD, and the
         * dashboard gates all six of its panels on a single `Dashboard` form
         * right instead of on each module's own — 41 checks in `Home/Index` and
         * its partials, every one of them `FormName == "Dashboard"`.
         *
         * So `supplier.approve` is a right an administrator has to grant
         * deliberately at cutover. It belongs with doc 19 Question 11.
         */
        isApproved: true,
      },
      /**
       * Item, WITH approve. `ItemMasterController.cs:97` reads
       * `FormName == "Item" && a.IsApproved` to decide whether to render the
       * approve control, so the right is real and already in use — it was simply
       * never granted here, because nothing in the port could reach it until the
       * dashboard queues existed.
       */
      { userId: admin.id, formId: 8, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true, isApproved: true },
      /**
       * Purchase Request, including APPROVE. The approval flow is the point of
       * the screen, and without this right its buttons never render — which
       * would look like a broken page rather than a withheld permission.
       */
      { userId: admin.id, formId: 9, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true, isApproved: true },
      // Inventory Inward, including APPROVE, for the same reason.
      { userId: admin.id, formId: 10, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true, isApproved: true },
      { userId: admin.id, formId: 11, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true, isApproved: true },
      /** Sales Invoice, all five rights. */
      { userId: admin.id, formId: 12, isViewAllow: true, isAddAllow: true, isEditAllow: true, isDeleteAllow: true, isApproved: true },
    ]);

    /**
     * Purchase requests, numbered the way the server numbers them.
     *
     * The counter row is seeded to match, because the sequence is the database's
     * to hand out — leaving it at 1 would make the next request created in the
     * UI collide with one of these.
     *
     * One request deliberately carries no `itemId` and only free text: that row
     * is INVISIBLE in the .NET list, which inner-joins ItemMaster, and visible
     * here. It is the case the departure exists for, so local dev shows it.
     */
    const financialYearLabel = financialYear.format(financialYear.currentAsProduced(new Date()));
    const requestCount = 18;

    await db.insert(purchaseRequests).values(
      Array.from({ length: requestCount }, (_, i) => {
        const item = insertedItems[i % insertedItems.length]!;
        const offCatalogue = i % 6 === 5;
        return {
          prNo: `PR/${financialYearLabel}/${String(i + 1).padStart(3, "0")}`,
          siteId: insertedSites[i % insertedSites.length]!.id,
          itemId: offCatalogue ? null : item.id,
          itemName: offCatalogue ? OFF_CATALOGUE_REQUESTS[i % OFF_CATALOGUE_REQUESTS.length]! : null,
          itemDescription: i % 4 === 0 ? "Site engineer to confirm grade before dispatch" : null,
          unitId: item.unitId,
          // Quantities are decimal STRINGS, like money, and some are fractional
          // so the display trimming is exercised rather than assumed.
          quantity: i % 3 === 0 ? String(i + 1) + ".50" : String((i + 1) * 25) + ".00",
          documentDate: new Date(Date.UTC(2026, 7, ((i * 3) % 27) + 1)),
          siteAddress: i % 5 === 0 ? "Gate 2, materials yard" : null,
          // A third approved, so both states and both buttons are on screen.
          isApproved: i % 3 === 0,
          createdBy: admin.id,
        };
      }),
    );

    await db.insert(documentCounters).values({
      documentType: "purchase_request",
      financialYear: financialYearLabel,
      nextValue: requestCount + 1,
    });

    /**
     * Purchase orders — a header with lines, and the first seeded document that
     * carries money.
     *
     * NUMBERED PER COMPANY, so the sequence restarts for each one and the seeded
     * numbers look like production's: `DHP/PO/26-27/001`, `DEMO/PO/26-27/001`.
     * The counters below are seeded to match, one row per company, which is the
     * shape the new company dimension on `document_counters` exists for.
     *
     * The totals are computed with the SAME function the API uses rather than
     * typed in. A seed with hand-written totals is a seed that disagrees with the
     * application the moment either changes, and the disagreement looks like a
     * bug in the arithmetic.
     */
    const ordersPerCompany = 4;
    const orderRows: (typeof purchaseOrders.$inferInsert)[] = [];
    const orderLineRows: (typeof purchaseOrderItems.$inferInsert)[] = [];

    /**
     * How many orders have already been placed at each site.
     *
     * Approval is decided from THIS, not from any expression in `offset`, and the
     * reason is worth stating because two attempts got it wrong before this one.
     *
     * The site is `offset % 45`. Anything of the form `f(offset) % 3` is constant
     * within a site whenever stepping the offset by 45 leaves `f` unchanged mod 3
     * — which `offset % 3` does (3 divides 45) and which `(companyIndex + n) % 3`
     * also does (stepping by 45 moves it by exactly 12, and 3 divides 12). Both
     * produced sites that were uniformly approved, an empty dashboard queue, and
     * a screen that looks broken while working correctly — the §5q trap arrived
     * at by arithmetic.
     *
     * A per-site counter cannot have that failure by construction: the first
     * order at every site is pending and the rest are approved, so every site
     * shows both states no matter how the offsets happen to fall.
     */
    const ordersAtSite = new Map<number, number>();

    insertedCompanies.forEach((company, companyIndex) => {
      for (let n = 0; n < ordersPerCompany; n += 1) {
        const orderId = randomUUID();
        const seq = n + 1;
        const offset = companyIndex * ordersPerCompany + n;

        const siteIndex = offset % insertedSites.length;
        const seqAtSite = ordersAtSite.get(siteIndex) ?? 0;
        ordersAtSite.set(siteIndex, seqAtSite + 1);

        // Two or three lines each, so the line count column is not always the
        // same number and the footer aggregate has something to add up.
        const lineCount = 2 + (offset % 2);
        const lines = Array.from({ length: lineCount }, (_, l) => {
          const item = insertedItems[(offset * 3 + l) % insertedItems.length]!;
          // A quantity with paise in it, so the decimal path is exercised.
          const quantity = l === 1 ? "2.50" : String((l + 1) * 10) + ".00";
          const unitPrice = String(250 + offset * 37 + l * 13) + ".00";
          const gstPercent = ["18.00", "12.00", "5.00"][l % 3]!;
          return { item, quantity, unitPrice, gstPercent };
        });

        const totals = purchaseOrderTotal.compute(
          lines.map((line) => ({
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            gstPercent: line.gstPercent,
          })),
        );

        orderRows.push({
          id: orderId,
          poNo: `${company.invoicePrefix}/PO/${financialYearLabel}/${String(seq).padStart(3, "0")}`,
          siteId: insertedSites[offset % insertedSites.length]!.id,
          supplierId: insertedSuppliers[offset % insertedSuppliers.length]!.id,
          companyId: company.id,
          documentDate: new Date(Date.UTC(2026, 7, ((offset * 5) % 27) + 1)),
          buyersPurchaseNo: offset % 3 === 0 ? `BPO-${1000 + offset}` : null,
          // One in four is immediate rather than dated, so both halves of the
          // split delivery-schedule column appear locally.
          deliveryImmediate: offset % 4 === 0,
          deliveryDate:
            offset % 4 === 0 ? null : new Date(Date.UTC(2026, 8, ((offset * 2) % 27) + 1)),
          contactName: "Site engineer",
          contactNumber: "9825012345",
          dispatchBy: offset % 2 === 0 ? "Road" : "Rail",
          paymentTerms: "30 days from invoice",
          subtotal: totals.subtotal,
          totalGstAmount: totals.totalGst,
          totalAmount: totals.grandTotal,
          // One in four inactive, because the list's status filter defaults to
          // Active and a filter with nothing to exclude proves nothing.
          // gcd(4, 45) = 1, so this genuinely varies within any one site.
          isActive: offset % 4 !== 3,
          // The FIRST order at each site is pending, the rest are approved — so
          // every site shows both states and every site's dashboard queue has a
          // row in it. See the note on `ordersAtSite` for the two arithmetic
          // versions of this that silently did the opposite.
          isApproved: seqAtSite > 0,
          createdBy: admin.id,
        });

        lines.forEach((line, l) => {
          orderLineRows.push({
            purchaseOrderId: orderId,
            itemId: line.item.id,
            unitId: line.item.unitId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            gstPercent: line.gstPercent,
            gstAmount: totals.lines[l]!.gstAmount,
            lineTotal: totals.lines[l]!.total,
            lineNumber: l + 1,
            createdBy: admin.id,
          });
        });
      }
    });

    await db.insert(purchaseOrders).values(orderRows);
    await db.insert(purchaseOrderItems).values(orderLineRows);

    await db.insert(documentCounters).values(
      insertedCompanies.map((company) => ({
        documentType: "purchase_order",
        financialYear: financialYearLabel,
        companyId: company.id,
        nextValue: ordersPerCompany + 1,
      })),
    );

    /**
     * Purchase invoices — the document B-2 was written about.
     *
     * Totals come from `invoiceTotal.corrected()`, the same function the API
     * uses, for the reason the orders above give: a seed with hand-written
     * totals disagrees with the application the moment either changes, and the
     * disagreement reads as an arithmetic bug.
     *
     * WHAT THIS SEED IS SHAPED TO EXERCISE, because a screen that has never seen
     * these locally is a screen that meets them first in production:
     *
     *  - EVERY invoice carries TDS or an adjustment or both, so the two terms
     *    the live calculator silently drops are visible in every total here.
     *  - Adjustments are NEGATIVE as often as positive — nudging a total down to
     *    match a supplier's paperwork is the common case and a signed column
     *    that only ever holds positives is untested.
     *  - Discounts are per unit and on some lines only, so the derived percent
     *    column has both a zero and a real value to render.
     *  - Supplier numbers are in the real formats from `10-purchase-invoice.md`
     *    — `BB/154`, `016`, `AE/26-27/00872` — including two suppliers reusing
     *    the SAME number, which the contract deliberately permits.
     *  - One invoice has NO supplier number at all, so `displayNo`'s fallback is
     *    exercised rather than assumed. That is the row the legacy list renders
     *    as an empty, unclickable link.
     *  - All three invoice types appear, so the returns the reports will have to
     *    treat differently (D7) already exist as data.
     */
    const invoicesPerCompany = 3;
    const invoiceRows: (typeof purchaseInvoices.$inferInsert)[] = [];
    const invoiceLineRows: (typeof purchaseInvoiceItems.$inferInsert)[] = [];

    /** Per-site counter, for the reason `ordersAtSite` explains at length. */
    const invoicesAtSite = new Map<number, number>();

    const SUPPLIER_NUMBER_FORMATS = [
      (n: number) => `BB/${150 + n}`,
      (n: number) => String(10 + n).padStart(3, "0"),
      (n: number) => `AE/26-27/${String(800 + n).padStart(5, "0")}`,
      (n: number) => `BE-2026-27-${4700 + n}`,
      // Deliberately CONSTANT: several suppliers all issue an invoice numbered
      // "016". No uniqueness is claimed across suppliers or within one, and the
      // list must stay usable when the number is not a key.
      () => "016",
    ];

    insertedCompanies.forEach((company, companyIndex) => {
      for (let n = 0; n < invoicesPerCompany; n += 1) {
        const invoiceId = randomUUID();
        const offset = companyIndex * invoicesPerCompany + n;

        const siteIndex = offset % insertedSites.length;
        const seqAtSite = invoicesAtSite.get(siteIndex) ?? 0;
        invoicesAtSite.set(siteIndex, seqAtSite + 1);

        const lineCount = 2 + (offset % 3);
        const lines = Array.from({ length: lineCount }, (_, l) => {
          const item = insertedItems[(offset * 5 + l) % insertedItems.length]!;
          const quantity = l === 1 ? "3.50" : String((l + 1) * 8) + ".00";
          const unitPrice = String(180 + offset * 41 + l * 17) + ".00";
          // No discount on every third line, so the derived percent column shows
          // both "0.00" and a real figure.
          const discountPerUnit = l % 3 === 2 ? "0" : String(5 + l * 2) + ".00";
          const gstPercent = ["18.00", "12.00", "5.00", "28.00"][l % 4]!;
          return { item, quantity, unitPrice, discountPerUnit, gstPercent };
        });

        // Every invoice has at least one of the two, and the adjustment is
        // negative half the time.
        const tds = offset % 2 === 0 ? String(250 + offset * 15) + ".00" : "0";
        const roundOff = offset % 2 === 0 ? "0" : (offset % 4 === 1 ? "-" : "") + "12.50";

        const totals = invoiceTotal.corrected(
          lines.map((line) => ({
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            discountPerUnit: line.discountPerUnit,
            gstPercent: line.gstPercent,
          })),
          { tds, roundOff },
        );

        // One in nine has no supplier number, so `displayNo` falls back.
        const hasSupplierNo = offset % 9 !== 4;
        const format = SUPPLIER_NUMBER_FORMATS[offset % SUPPLIER_NUMBER_FORMATS.length]!;

        invoiceRows.push({
          id: invoiceId,
          supplierInvoiceNo: hasSupplierNo ? format(offset) : null,
          invoiceNo: hasSupplierNo ? null : `INV/${financialYearLabel}/${offset}`,
          // One in seven is a return or a credit note. gcd(7, 45) = 1, so these
          // do not land on the same sites every time.
          invoiceType:
            offset % 7 === 3 ? "Purchase Return" : offset % 7 === 5 ? "Credit Note" : "Purchase",
          siteId: insertedSites[siteIndex]!.id,
          supplierId: insertedSuppliers[offset % insertedSuppliers.length]!.id,
          companyId: company.id,
          // Every third invoice cites the purchase order it bills against — the
          // text match that becomes a real foreign key here.
          purchaseOrderId: offset % 3 === 0 ? orderRows[offset % orderRows.length]!.id! : null,
          documentDate: new Date(Date.UTC(2026, 7, ((offset * 7) % 27) + 1)),
          challanNo: `CH-${2000 + offset}`,
          lrNo: offset % 2 === 0 ? `LR-${500 + offset}` : null,
          vehicleNo: offset % 2 === 0 ? `GJ 01 AB ${1000 + offset}` : null,
          dispatchBy: offset % 2 === 0 ? "Road" : "Rail",
          paymentTerms: "30 days from invoice",
          contactName: "Stores",
          contactNumber: "9825054321",
          subtotal: totals.subtotal,
          totalGstAmount: totals.totalGst,
          totalDiscount: totals.totalDiscount,
          tds: totals.tds,
          roundOff: totals.roundOff,
          totalAmount: totals.grandTotal,
          // Carried from the payments screens, which are Phase 5 — held so the
          // list can show a state it does not itself write.
          paymentStatus: offset % 4 === 0 ? "Paid" : offset % 4 === 1 ? "Part paid" : "Unpaid",
          isPaidOut: offset % 4 === 0,
          // First invoice at each site pending, the rest approved — so the sixth
          // dashboard queue has a row at every site.
          isApproved: seqAtSite > 0,
          createdBy: admin.id,
        });

        lines.forEach((line, l) => {
          invoiceLineRows.push({
            purchaseInvoiceId: invoiceId,
            itemId: line.item.id,
            unitId: line.item.unitId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPerUnit: line.discountPerUnit,
            gstPercent: line.gstPercent,
            gstAmount: totals.lines[l]!.gstAmount,
            netAmount: totals.lines[l]!.netAmount,
            lineTotal: totals.lines[l]!.total,
            lineNumber: l + 1,
            createdBy: admin.id,
          });
        });
      }
    });

    await db.insert(purchaseInvoices).values(invoiceRows);
    await db.insert(purchaseInvoiceItems).values(invoiceLineRows);

    /**
     * Sales invoices — the same document, the other direction.
     *
     * The number is OURS here, so unlike the purchase invoices these carry a
     * generated `DHP/26-27/001` and the counter row is seeded to match. Leaving
     * the counter at 1 would make the next invoice created in the UI collide
     * with one of these, which is the same trap the purchase requests document.
     *
     * NOTE THE FORMAT has no document-type segment, where a purchase order has
     * `/PO/`. That asymmetry is the source's.
     *
     * The customer is a row from `suppliers` — one party table holds both sides
     * of the trade. Picked from the FAR END of the list so the sales screens do
     * not show the same names as the purchase ones, which makes it obvious at a
     * glance which direction a document belongs to.
     */
    const salesPerCompany = 2;
    const salesRows: (typeof salesInvoices.$inferInsert)[] = [];
    const salesLineRows: (typeof salesInvoiceItems.$inferInsert)[] = [];
    const salesAtSite = new Map<number, number>();

    insertedCompanies.forEach((company, companyIndex) => {
      for (let n = 0; n < salesPerCompany; n += 1) {
        const invoiceId = randomUUID();
        const seq = n + 1;
        const offset = companyIndex * salesPerCompany + n;

        const siteIndex = offset % insertedSites.length;
        const seqAtSite = salesAtSite.get(siteIndex) ?? 0;
        salesAtSite.set(siteIndex, seqAtSite + 1);

        const lineCount = 1 + (offset % 3);
        const lines = Array.from({ length: lineCount }, (_, l) => {
          const item = insertedItems[(offset * 7 + l) % insertedItems.length]!;
          const quantity = l === 0 ? "6.00" : "1.25";
          const unitPrice = String(320 + offset * 53 + l * 29) + ".00";
          const discountPerUnit = l % 2 === 0 ? String(10 + l * 5) + ".00" : "0";
          const gstPercent = ["18.00", "5.00", "12.00"][l % 3]!;
          return { item, quantity, unitPrice, discountPerUnit, gstPercent };
        });

        const tds = offset % 3 === 0 ? String(100 + offset * 20) + ".00" : "0";
        const roundOff = offset % 3 === 1 ? "-8.25" : offset % 3 === 2 ? "6.75" : "0";

        const totals = invoiceTotal.corrected(
          lines.map((line) => ({
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            discountPerUnit: line.discountPerUnit,
            gstPercent: line.gstPercent,
          })),
          { tds, roundOff },
        );

        salesRows.push({
          id: invoiceId,
          salesInvoiceNo: `${company.invoicePrefix}/${financialYearLabel}/${String(seq).padStart(3, "0")}`,
          customerInvoiceNo: offset % 4 === 0 ? `PO-${7000 + offset}` : null,
          invoiceType:
            offset % 8 === 3 ? "Sales Return" : offset % 8 === 6 ? "Credit Note" : "Sales",
          siteId: insertedSites[siteIndex]!.id,
          // From the far end of the party list — see the note above.
          customerId:
            insertedSuppliers[insertedSuppliers.length - 1 - (offset % insertedSuppliers.length)]!
              .id,
          companyId: company.id,
          documentDate: new Date(Date.UTC(2026, 7, ((offset * 11) % 27) + 1)),
          challanNo: `SC-${4000 + offset}`,
          vehicleNo: offset % 2 === 0 ? `GJ 05 CD ${2000 + offset}` : null,
          dispatchBy: offset % 2 === 0 ? "Road" : "Rail",
          paymentTerms: "15 days from invoice",
          contactName: "Accounts",
          contactNumber: "9825098765",
          shippingAddress: `Plot ${20 + offset}, ${company.name} yard`,
          subtotal: totals.subtotal,
          totalGstAmount: totals.totalGst,
          totalDiscount: totals.totalDiscount,
          tds: totals.tds,
          roundOff: totals.roundOff,
          totalAmount: totals.grandTotal,
          paymentStatus: offset % 3 === 0 ? "Paid" : "Unpaid",
          isPaidIn: offset % 3 === 0,
          isApproved: seqAtSite > 0,
          createdBy: admin.id,
        });

        lines.forEach((line, l) => {
          salesLineRows.push({
            salesInvoiceId: invoiceId,
            itemId: line.item.id,
            unitId: line.item.unitId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPerUnit: line.discountPerUnit,
            gstPercent: line.gstPercent,
            gstAmount: totals.lines[l]!.gstAmount,
            netAmount: totals.lines[l]!.netAmount,
            lineTotal: totals.lines[l]!.total,
            lineNumber: l + 1,
            createdBy: admin.id,
          });
        });
      }
    });

    await db.insert(salesInvoices).values(salesRows);
    await db.insert(salesInvoiceItems).values(salesLineRows);

    await db.insert(documentCounters).values(
      insertedCompanies.map((company) => ({
        documentType: "sales_invoice",
        financialYear: financialYearLabel,
        companyId: company.id,
        nextValue: salesPerCompany + 1,
      })),
    );

    /**
     * Inventory arrivals.
     *
     * TWO IN FIVE CARRY NO SITE, on purpose. Every row imported from production
     * has `site_id IS NULL` because the .NET create form has no site field, so
     * the local database has to contain that population or the site filter looks
     * correct in development and empties the screen in production. It is also
     * what makes the "recorded before this system" notice appear.
     *
     * Approval is mixed. The source creates every arrival approved, so nobody
     * has ever seen the pending state on this screen.
     */
    await db.insert(inventoryInward).values(
      Array.from({ length: 14 }, (_, i) => {
        const item = insertedItems[(i * 3) % insertedItems.length]!;
        const unallocated = i % 5 < 2;
        return {
          // Concentrated on the first few sites, so the site a seeded user is
          // actually assigned to has both allocated and unallocated rows and the
          // screen shows the mix rather than one half of it.
          siteId: unallocated ? null : insertedSites[i % 3]!.id,
          itemId: item.id,
          itemName: item.name,
          unitId: item.unitId,
          quantity: i % 4 === 0 ? String((i + 1) * 10) + ".50" : String((i + 1) * 100) + ".00",
          documentDate: new Date(Date.UTC(2026, 6, ((i * 5) % 27) + 1)),
          details: i % 3 === 0 ? INVENTORY_DETAILS[i % INVENTORY_DETAILS.length]! : null,
          isApproved: i % 4 !== 0,
          createdBy: admin.id,
        };
      }),
    );

    /**
     * Inward challans.
     *
     * One in four carries NO SUPPLIER, because the source's registered create
     * path drops `SupplierId` on the floor — so that population exists in
     * production and the screen has to render it as something other than blank.
     * A couple carry no invoice number for the same reason.
     *
     * Quantities are deliberately mixed in scale, because the footer total is
     * the point of this screen and a total of similar numbers proves nothing.
     */
    const insertedChallans = await db
      .insert(inwardChallans)
      .values(
        Array.from({ length: 16 }, (_, i) => {
          const item = insertedItems[(i * 5) % insertedItems.length]!;
          const noSupplier = i % 4 === 3;
          return {
            siteId: insertedSites[i % 3]!.id,
            itemId: item.id,
            itemName: item.name,
            supplierId: noSupplier ? null : insertedSuppliers[i % insertedSuppliers.length]!.id,
            unitId: item.unitId,
            quantity:
              i % 3 === 0 ? String((i + 1) * 1000) + ".00" : String((i + 1) * 7) + ".62",
            invoiceNo: noSupplier ? null : CHALLAN_INVOICE_NOS[i % CHALLAN_INVOICE_NOS.length]!,
            documentDate: new Date(Date.UTC(2026, 5 + (i % 3), ((i * 4) % 27) + 1)),
            vehicleNumber: i % 5 === 0 ? null : "GJ 06 " + String(1000 + i * 37),
            // The site is chosen by i % 3, so anything else keyed on 3 aliases
            // with it and one site ends up with a column of identical values.
            receiverName: i % 4 === 0 ? RECEIVER_NAMES[(i >> 1) % RECEIVER_NAMES.length]! : null,
            isApproved: i % 5 !== 1,
            createdBy: admin.id,
          };
        }),
      )
      .returning({ id: inwardChallans.id });

    // Attachments on a few of them. Names only: the bytes live on the old web
    // server and there is nowhere to put them here yet.
    await db.insert(inwardChallanDocuments).values(
      insertedChallans.flatMap((challan, i) =>
        i % 5 === 0
          ? [
              { challanId: challan.id, documentName: `challan-${i + 1}.pdf` },
              { challanId: challan.id, documentName: `weighbridge-${i + 1}.jpg` },
            ]
          : [],
      ),
    );

    await db.insert(userSites).values(
      seeded.flatMap((user, index) =>
        insertedSites
          .slice(0, (index % 3) + 1)
          .map((site) => ({ userId: user.id, siteId: site.id })),
      ),
    );

    await db.insert(userCompanies).values(
      seeded.flatMap((user, index) =>
        insertedCompanies
          .slice(0, (index % 4) + 1)
          .map((company) => ({ userId: user.id, companyId: company.id })),
      ),
    );

    this.logger.warn(
      "Seeded " +
        seeded.length +
        " users, " +
        insertedCompanies.length +
        " companies, " +
        insertedSites.length +
        " sites and " +
        insertedGroups.length +
        " site groups. Sign in as 'devuser' / '" +
        DEV_PASSWORD +
        "'.",
    );
  }

  /**
   * Seeds from a JSON snapshot of REAL master data produced by
   * `tools/import-masters --snapshot`, instead of generating dummy records.
   *
   * The snapshot stores DATABASE column names (snake_case) because it was built
   * to be loadable by raw SQL too. Drizzle's `.values()` wants the TypeScript
   * property names, so the mapping is derived from the table definitions rather
   * than hand-written thirteen times — one place to be wrong instead of many.
   */
  private async seedFromSnapshot(db: Database, path: string): Promise<void> {
    const { readFileSync, existsSync } = await import("node:fs");

    if (!existsSync(path)) {
      this.logger.error(
        `SEED_SNAPSHOT points at ${path}, which does not exist. ` +
          "Generate it with: node --env-file=.env.local import.mjs --snapshot <path>",
      );
      return;
    }

    const snapshot = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      Record<string, unknown>[]
    >;

    /** Maps one snapshot row onto a table's TypeScript property names. */
    const toRow = (table: Record<string, unknown>, row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [property, column] of Object.entries(table)) {
        const col = column as { name?: string; dataType?: string } | null;
        if (!col || typeof col !== "object" || typeof col.name !== "string") continue;

        const value = row[col.name];
        if (value === undefined) continue;

        // JSON has no date type, so timestamps arrive as ISO strings.
        out[property] =
          col.dataType === "date" && typeof value === "string" ? new Date(value) : value;
      }
      return out;
    };

    // Insert order is foreign-key order. The snapshot is keyed by table name.
    const order: [string, Record<string, unknown>][] = [
      ["units", units as unknown as Record<string, unknown>],
      ["forms", forms as unknown as Record<string, unknown>],
      ["companies", companies as unknown as Record<string, unknown>],
      ["sites", sites as unknown as Record<string, unknown>],
      ["users", users as unknown as Record<string, unknown>],
      ["suppliers", suppliers as unknown as Record<string, unknown>],
      ["items", items as unknown as Record<string, unknown>],
      ["site_groups", siteGroups as unknown as Record<string, unknown>],
      ["site_group_sites", siteGroupSites as unknown as Record<string, unknown>],
      ["site_group_addresses", siteGroupAddresses as unknown as Record<string, unknown>],
      ["user_sites", userSites as unknown as Record<string, unknown>],
      ["user_companies", userCompanies as unknown as Record<string, unknown>],
      ["user_form_permissions", userFormPermissions as unknown as Record<string, unknown>],
      ["inventory_inward", inventoryInward as unknown as Record<string, unknown>],
      ["inward_challans", inwardChallans as unknown as Record<string, unknown>],
    ];

    const counts: string[] = [];
    const refused: string[] = [];

    for (const [name, table] of order) {
      const rows = snapshot[name] ?? [];
      if (rows.length === 0) continue;

      const mapped = rows.map((r) => toRow(table, r));

      // onConflictDoNothing is what lets a re-seed be idempotent, but it also
      // discards rows the target's unique indexes refuse — and doing that
      // silently would leave a grid that looks complete and is not. Count what
      // actually landed and say so.
      let inserted = 0;
      for (let i = 0; i < mapped.length; i += 200) {
        const result = await db
          .insert(table as never)
          .values(mapped.slice(i, i + 200) as never)
          .onConflictDoNothing()
          .returning({ ok: sql<number>`1` });
        inserted += result.length;
      }

      counts.push(`${inserted} ${name}`);
      if (inserted < rows.length) {
        refused.push(`${rows.length - inserted} ${name}`);
      }
    }

    // units.id and forms.id were inserted explicitly, so their identity
    // sequences are still at 1 and the next insert from the app would collide.
    for (const table of ["units", "forms"]) {
      await db.execute(
        sql.raw(
          `select setval(pg_get_serial_sequence('${table}','id'), ` +
            `coalesce((select max(id) from ${table}), 1))`,
        ),
      );
    }

    const meta = (snapshot.__meta ?? {}) as unknown as {
      source?: string;
      devPassword?: string;
    };
    this.logger.warn(
      `Seeded REAL data from ${path} (source: ${meta.source ?? "unknown"}): ` +
        counts.join(", ") +
        `. Every user's password is '${meta.devPassword ?? DEV_PASSWORD}' — ` +
        "real passwords were never copied.",
    );

    if (refused.length > 0) {
      this.logger.error(
        `REFUSED by a unique index and NOT loaded: ${refused.join(", ")}. ` +
          "The source has no such constraint, so these are real duplicates in the " +
          "data — the grids below are missing those rows.",
      );
    }
  }
}

const FIRST_NAMES = ["Amit", "Priya", "Rahul", "Neha", "Vikram", "Anjali", "Suresh", "Meera"];
const LAST_NAMES = ["Patel", "Shah", "Desai", "Mehta", "Joshi", "Trivedi", "Parmar", "Shah"];

const AREAS = [
  "Navrangpura",
  "Satellite",
  "Bopal",
  "Maninagar",
  "Vastrapur",
  "Thaltej",
  "Gota",
  "Chandkheda",
  "Prahlad Nagar",
  "Bodakdev",
];
const BANKS = ["HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra Bank"];
const BANK_CODES = ["HDFC", "ICIC", "SBIN", "UTIB", "KKBK"];
const GST_CHECK = ["5", "7", "2", "9", "4", "1", "8", "3", "6", "0"];

const initialsOf = (name: string): string =>
  name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);

/**
 * Initials for each name, with a digit appended to any that would repeat.
 *
 * `AB`, `AB` becomes `AB`, `AB2`. Order-stable, so re-seeding gives the same
 * prefixes and the document numbers in a screenshot stay meaningful.
 */
const uniquePrefixes = (names: readonly string[]): string[] => {
  const used = new Map<string, number>();
  return names.map((name) => {
    const base = initialsOf(name);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}${seen + 1}`;
  });
};

/** A format-shaped PAN: 5 letters, 4 digits, 1 letter. Not a real number. */
const panFor = (i: number): string =>
  "AA" +
  String.fromCharCode(65 + (i % 26)) +
  "CD" +
  String(1000 + i) +
  String.fromCharCode(65 + (i % 26));

const COMPANY_NAMES = [
  "D H Infra",
  "Shreeji Constructions",
  "Anand Buildcon",
  "Nakoda Developers",
  "Rajhans Projects",
  "Satyam Infrastructure",
  "Gokul Enterprise",
  "Vraj Builders",
  "Krishna Construction",
  "Mahavir Infra",
  "Siddhi Vinayak Projects",
  "Om Developers",
  "Parshwanath Buildcon",
  "Yash Infrastructure",
  "Aarya Constructions",
  "Divya Projects",
  "Sagar Enterprise",
  "Trimurti Builders",
  "Nilkanth Infra",
  "Ganesh Developers",
  "Shivam Construction",
  "Radhe Projects",
  "Ambica Buildcon",
  "Jalaram Infra",
  "Umiya Developers",
  "Balaji Enterprise",
  "Sardar Constructions",
  "Narmada Projects",
  "Sabarmati Buildcon",
  "Gujarat Infra Works",
];

const SITE_NAMES = [
  "Ahmedabad Riverfront",
  "Rajkot Ring Road",
  "Surat Diamond Park",
  "Vadodara Alkapuri",
  "Gandhinagar Sector 21",
  "Bhavnagar Port Yard",
  "Jamnagar Refinery Road",
  "Anand Dairy Road",
  "Nadiad Bypass",
  "Mehsana Highway",
  "Palanpur Junction",
  "Bharuch Chemical Zone",
  "Ankleshwar GIDC",
  "Vapi Industrial",
  "Valsad Coastal",
  "Navsari Green Field",
  "Godhra East",
  "Dahod Hillside",
  "Patan Heritage",
  "Morbi Ceramic Park",
  "Junagadh Foothills",
  "Porbandar Marine",
  "Amreli Central",
  "Botad Junction",
  "Surendranagar Mills",
  "Kutch Solar Park",
  "Bhuj North",
  "Gandhidham Logistics",
  "Mundra Port Side",
  "Dwarka Coastal",
  "Somnath Temple Road",
  "Veraval Fishery",
  "Dediapada Forest",
  "Rajpipla Riverside",
  "Chhota Udepur",
  "Halol Auto Zone",
  "Kalol Industrial",
  "Kadi Textile Park",
  "Vijapur Rural",
  "Himatnagar North",
  "Modasa Central",
  "Idar Hillside",
  "Deesa Agro Park",
  "Radhanpur Desert Edge",
  "Tharad Border Road",
];

const GROUP_NAMES = [
  "North Gujarat",
  "South Gujarat",
  "Saurashtra",
  "Kutch Region",
  "Ahmedabad Metro",
  "Industrial Corridor",
  "Coastal Belt",
  "Highway Projects",
  "Government Contracts",
  "Private Housing",
  "Solar Division",
  "Port Works",
];

/**
 * Units of measure, as a construction supplier would actually use them. Short
 * enough that the Items grid's unit column stays readable at a glance.
 */
const UNIT_NAMES = [
  "Nos",
  "Kg",
  "Ton",
  "Meter",
  "Sq. Meter",
  "Cu. Meter",
  "Litre",
  "Bag",
  "Bundle",
  "Roll",
  "Box",
  "Set",
];

/** The four GST slabs in force in India. */
const GST_RATES = ["5.00", "12.00", "18.00", "28.00"];

const SUPPLIER_NAMES = [
  "Ambica Steel Traders",
  "Bhagwati Cement Agency",
  "Chamunda Hardware",
  "Dev Electricals",
  "Ekta Sanitary Stores",
  "Gayatri Timber Mart",
  "Harsh Paint House",
  "Ishwar Tiles and Marbles",
  "Jay Ambe Iron Works",
  "Kailash Plywood",
  "Laxmi Pipe Suppliers",
  "Mahadev Glass House",
  "Navkar Aggregates",
  "Om Sai Ready Mix",
  "Patel Brick Works",
  "Radhika Electricals",
  "Sagar Steel Corporation",
  "Tirupati Hardware Mart",
  "Umiya Cement Depot",
  "Vishwakarma Fabricators",
  "Yogeshwar Waterproofing",
  "Zenith Safety Products",
  "Anmol Adhesives",
  "Bajrang Transport and Supply",
  "Chirag Lighting House",
  "Dhanlaxmi Sand Suppliers",
  "Everest Roofing Solutions",
  "Falcon Tools and Machinery",
  "Ganpati Steel Rolling",
  "Hariom Construction Chemicals",
];

const ITEM_NAMES = [
  "OPC 53 Grade Cement",
  "PPC Cement",
  "TMT Bar 8mm",
  "TMT Bar 10mm",
  "TMT Bar 12mm",
  "TMT Bar 16mm",
  "TMT Bar 20mm",
  "River Sand",
  "M Sand",
  "20mm Aggregate",
  "10mm Aggregate",
  "Red Clay Brick",
  "AAC Block 600x200x100",
  "Fly Ash Brick",
  "Ready Mix Concrete M20",
  "Ready Mix Concrete M25",
  "Binding Wire",
  "MS Angle 50x50",
  "MS Channel 100mm",
  "GI Pipe 25mm",
  "CPVC Pipe 20mm",
  "PVC Pipe 110mm",
  "Vitrified Tile 600x600",
  "Ceramic Wall Tile 300x600",
  "Granite Slab",
  "Marble Slab",
  "Plywood 19mm BWP",
  "Teak Wood Plank",
  "Door Frame Sal Wood",
  "Flush Door 32mm",
  "Emulsion Paint Interior",
  "Enamel Paint",
  "Wall Putty",
  "Waterproofing Compound",
  "Tile Adhesive",
  "White Cement",
  "Copper Wire 2.5 sq mm",
  "MCB 32A Single Pole",
  "Distribution Board 8 Way",
  "LED Panel Light 18W",
  "Modular Switch 6A",
  "Ceiling Fan 1200mm",
  "Wash Basin Ceramic",
  "EWC Toilet Seat",
  "CP Bib Cock",
  "Stainless Steel Sink",
  "Scaffolding Pipe",
  "Safety Helmet",
  "Safety Harness",
  "Shuttering Plywood 12mm",
];

/**
 * Things a site asks for that are not in the item catalogue — hire, labour,
 * one-off services. The source supports these through `ItemName` and then hides
 * them, because its list query inner-joins `ItemMaster`.
 */
const OFF_CATALOGUE_REQUESTS = [
  "Scaffolding hire - 2 weeks",
  "JCB with operator - day rate",
  "Water tanker - 5000L",
  "Crane hire - half day",
  "Site survey - external",
];

/**
 * Free text on an inventory arrival. Deliberately shaped like the real one —
 * "TO RAJAOUL" in the captured row is a destination, not a description, and this
 * column has never had an agreed meaning.
 */
const INVENTORY_DETAILS = [
  "TO RAJAOUL",
  "Received at gate 2, tally slip attached",
  "Short by 2 bags, supplier informed",
  "For the basement raft pour",
];

/**
 * Supplier invoice numbers as they actually appear: `922`, `1`, `253-1`. Free
 * text, and the reason `invoice_no` is not an integer column.
 */
const CHALLAN_INVOICE_NOS = ["922", "1", "253-1", "1851", "1716", "44/A"];

/**
 * Receiver names in the shape the source holds them —
 * `SURESHBHAI-CC-2000X2 7TH` is a person, a group code and a batch reference in
 * one field. Not normalised; see the schema.
 */
const RECEIVER_NAMES = [
  "SURESHBHAI-CC-2000X2 7TH",
  "RAMESHBHAI - GATE 2",
  "STOREKEEPER",
];
