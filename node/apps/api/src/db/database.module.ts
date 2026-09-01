import { Global, Logger, Module } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATABASE } from "./database";
import * as schema from "./schema";
import { ENV, type Env } from "../config/env";

/**
 * Provides the database handle.
 *
 *  - DATABASE_URL set        -> postgres.js against that server. Production always
 *                               takes this path; loadEnv() requires the variable.
 *  - development, no URL     -> an EMBEDDED PostgreSQL (PGlite, Postgres compiled
 *                               to WASM) with the real migrations applied, so the
 *                               app is fully usable with nothing installed. It is
 *                               in-memory: every restart starts clean.
 *  - anything else, no URL   -> null, and endpoints needing the database say so.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: async (env: Env) => {
        const logger = new Logger("DatabaseModule");

        if (env.DATABASE_URL) {
          return drizzle(postgres(env.DATABASE_URL, { max: 10 }), { schema });
        }

        if (env.NODE_ENV !== "development") {
          return null;
        }

        logger.warn(
          "DATABASE_URL is not set — starting an embedded in-memory PostgreSQL. " +
            "Data is discarded on restart. Development only.",
        );

        const { PGlite } = await import("@electric-sql/pglite");
        const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
        const client = await PGlite.create();

        // Exactly the migration SQL a real server would run.
        const dir = join(__dirname, "../../drizzle");
        const file = readdirSync(dir).find((name) => name.endsWith(".sql"));
        if (!file) {
          throw new Error(`No migration SQL found in ${dir}. Run: npm run db:generate`);
        }
        for (const statement of readFileSync(join(dir, file), "utf8").split(
          "--> statement-breakpoint",
        )) {
          if (statement.trim()) {
            await client.exec(statement);
          }
        }
        logger.log(`Embedded PostgreSQL ready (applied ${file})`);

        return drizzlePglite(client, { schema });
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
