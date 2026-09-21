-- Site Location: a location and its address become one PAIR (business, 17 Sep 2026).
--
-- On 15 Sep the business chose two independent lists — names in `site_locations`,
-- addresses in `site_location_addresses`, nothing joining them. On 17 Sep it asked
-- for the pair instead, which is the better answer: a delivery needs to know which
-- address belongs to which block, and two lists cannot say.

ALTER TABLE "site_locations" ADD COLUMN "address" text;
--> statement-breakpoint

-- The unique index has to stop covering blank names before the rows below arrive.
--
-- It reads `(site_id, lower(name)) WHERE is_deleted = false`, and the migrated
-- address-only rows all have name ''. BHAVNAGAR-RAJUBHAI alone has 8 of them, so
-- without this the INSERT fails on the second one. Blank names are now exempt;
-- two REAL locations called "Block A" are still refused.
DROP INDEX IF EXISTS "site_locations_site_name_key";
--> statement-breakpoint

CREATE UNIQUE INDEX "site_locations_site_name_key"
  ON "site_locations" ("site_id", lower("name"))
  WHERE "is_deleted" = false AND "name" <> '';
--> statement-breakpoint

-- Every existing address is carried across as a pair with NO location name.
--
-- THE PAIRING IS NOT GUESSED. There is no record of which address belonged to
-- which location — production holds 7 locations against 8 addresses on one site
-- and 16 against 6 on another — so pairing them by position would put a wrong
-- address on a live construction site. The business chose (17 Sep 2026) to carry
-- every address across unnamed and name them on screen.
INSERT INTO "site_locations" ("site_id", "name", "address", "is_deleted", "created_at")
SELECT "site_id", '', "address", false, now()
FROM "site_location_addresses"
ORDER BY "site_id", "line_number";
--> statement-breakpoint

-- `site_location_addresses` IS DELIBERATELY LEFT IN PLACE, and left populated.
--
-- Nothing reads it after this release: `documentOptions` takes shipping addresses
-- from `site_locations.address`, and the Site Location screen writes pairs. But a
-- dropped table is the one thing a rollback cannot undo, and the rows above are
-- the only copy of addresses people deliver material to. It costs nothing to keep
-- until the pairing has been tidied up and someone decides to drop it on purpose.
COMMENT ON TABLE "site_location_addresses" IS
  'Superseded by site_locations.address (0020, 17 Sep 2026). Read by nothing; kept as the pre-pairing copy of these addresses. Safe to drop once the pairs on Site Location have been named.';
