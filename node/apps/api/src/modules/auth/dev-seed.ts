import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InMemoryUserRepository, UserRepository } from "./user.repository";
import { ENV, type Env } from "../../config/env";
import { DATABASE, type Database } from "../../db/database";
import {
  companies,
  forms,
  siteGroupAddresses,
  siteGroupSites,
  siteGroups,
  sites,
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

    const insertedCompanies = await db
      .insert(companies)
      .values(
        COMPANY_NAMES.map((name, i) => ({
          name,
          invoicePrefix: initialsOf(name),
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
      .returning({ id: companies.id, name: companies.name });

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
      { id: 2, formName: "Supplier Invoice", controller: "Invoice", formGroup: "Invoicing", isActive: true },
      { id: 3, formName: "Purchase Order", controller: "PurchaseOrder", formGroup: "Purchase", isActive: true },
      { id: 4, formName: "Company", formGroup: "Masters", isActive: true },
      { id: 5, formName: "Site", formGroup: "Masters", isActive: true },
      { id: 6, formName: "Group", formGroup: "Masters", isActive: true },
    ]);

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
      { userId: admin.id, formId: 2, isViewAllow: true, isEditAllow: true, isApproved: true },
      { userId: admin.id, formId: 3, isViewAllow: true },
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
    ]);

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
