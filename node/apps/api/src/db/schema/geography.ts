import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Countries, states and cities — the address lookup tables.
 *
 * WHY THESE ARRIVED LATE. `companies`, `sites` and `suppliers` have carried
 * `city_id` / `state_id` / `country_id` as bare integers since the first
 * migration, with no foreign key and nothing to resolve them against. The reason
 * recorded in those schemas was that the lookup tables had never been extracted
 * and the orphan volume was unmeasured, so a real reference would have refused
 * rows the ETL still had to carry.
 *
 * THE CENSUS HAS NOW RUN, against the client's live database, over all thirteen
 * geography references:
 *
 *   SupplierMaster.City, .State                         205 set,  0 orphans
 *   Site.CityId, .StateId, .Country                      20 set,  0 orphans
 *   Site.ShippingCityId, .ShippingStateId, .ShippingCountry
 *                                                        20 set,  0 orphans
 *   Company.CityId, .StateId, .Country                    8 set,  0 orphans
 *   Cities.State_Id                                     603 set,  0 orphans
 *   States.Country_id                                    35 set,  0 orphans
 *
 * Not one orphan. So the integers were always valid; what was missing was the
 * 639 rows they point at. Every address in the application has been displaying a
 * number where a place name belongs.
 *
 * THE IDS ARE THE SOURCE'S OWN, and are inserted explicitly rather than
 * generated. `Cities.CityId` 412 must stay 412, because 205 suppliers, 20 sites
 * and 8 companies already hold that number and those columns are not being
 * rewritten.
 *
 * NO FOREIGN KEY IS DECLARED FROM THE ADDRESS TABLES YET, even though the census
 * says one would now hold. Adding it is a separate, deliberate change: the
 * development seed invents geography ids that no lookup row backs, so the
 * constraint would fail the seed and every test that depends on it. The census
 * result is the prerequisite, not the change itself.
 *
 * These are reference data, not business records: no soft delete, no audit
 * columns, because the source has none either.
 */

/** `Countries` in SQL Server. One row — India. */
export const countries = pgTable("countries", {
  /** `CountryId`. The source's own id, inserted explicitly. */
  id: integer("id").primaryKey(),
  /** `CountryCode`, e.g. "IN". `char` in the source, trimmed on the way in. */
  code: text("code"),
  /** `CountryName`. */
  name: text("name").notNull(),
});

/**
 * `States` in SQL Server. 35 rows.
 *
 * `StateCode` is an integer in the source, not the two-letter postal code the
 * name suggests — it is the GST state code (24 is Gujarat), which is why every
 * GST number in the data begins with it. It is NOT unique and is not constrained
 * to be: 35 states carry only 32 distinct codes, so three are shared or unset.
 */
export const states = pgTable(
  "states",
  {
    /** `StatesId`. */
    id: integer("id").primaryKey(),
    /** `StatesName`. */
    name: text("name").notNull(),
    /** `StateCode` — the GST state code, e.g. 24 for Gujarat. */
    stateCode: integer("state_code"),
    /** `Country_id`. */
    countryId: integer("country_id")
      .notNull()
      .references(() => countries.id),
  },
  (table) => [index("states_country_id_idx").on(table.countryId)],
);

/**
 * `Cities` in SQL Server. 603 rows.
 *
 * City names are NOT globally unique, and must not be constrained to be. Four
 * names are held twice in the live data — Aurangabad, Bilaspur, Hamirpur and
 * Pratapgarh — each time under two different states, which is correct rather
 * than duplication.
 */
export const cities = pgTable(
  "cities",
  {
    /** `CityId`. */
    id: integer("id").primaryKey(),
    /** `CityName`. */
    name: text("name").notNull(),
    /** `State_Id`. */
    stateId: integer("state_id")
      .notNull()
      .references(() => states.id),
  },
  (table) => [
    index("cities_state_id_idx").on(table.stateId),
    index("cities_name_lower_idx").on(sql`lower(${table.name})`),
    /**
     * A city name IS unique within its state — measured, zero violations across
     * all 603 live rows. Worth enforcing: the city is chosen from a dropdown
     * filtered by state, where two identical entries are indistinguishable.
     */
    uniqueIndex("cities_state_id_name_lower_key").on(table.stateId, sql`lower(${table.name})`),
  ],
);
