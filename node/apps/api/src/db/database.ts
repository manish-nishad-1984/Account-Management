import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * The database handle, typed so the same repository code runs against
 * postgres.js in production and PGlite in tests.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const DATABASE = Symbol("DATABASE");
