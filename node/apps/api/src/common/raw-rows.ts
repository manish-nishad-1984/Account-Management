/**
 * Normalises the result of `db.execute()` across the two drivers this system
 * runs on.
 *
 * THIS IS A TRAP THAT NO TEST IN THIS REPOSITORY WOULD OTHERWISE CATCH, because
 * the driver under test is not the driver in production:
 *
 *   tests + dev  `drizzle-orm/pglite`      -> { rows, fields, command, … }
 *   production   `drizzle-orm/postgres-js` -> a plain ARRAY of rows
 *
 * Verified by running both shapes rather than read from documentation: PGlite
 * returns `[ 'rows', 'fields', 'command', 'affectedRows', 'rowCount' ]` from
 * `Object.keys`. So `(await db.execute(...)).rows.map(...)` passes every test
 * here and throws `undefined is not iterable` the first time it runs on the
 * server, and `(await db.execute(...)).map(...)` does the exact opposite.
 *
 * Every other repository is safe from this because `db.select()` maps rows
 * itself, identically on both drivers. `execute` is the one hole, and the
 * reports module is the only place that needs it — a UNION feeding a window
 * function is not expressible in the query builder.
 *
 * The unit test beside this file exercises BOTH shapes with literal objects, so
 * the production branch is covered without a PostgreSQL server.
 */
export function rawRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  // Neither shape. Returning [] here would turn a driver change into an empty
  // report — a silent wrong answer, which is the thing this codebase keeps
  // finding in the system it is replacing.
  throw new Error(
    `Unrecognised database result shape: expected an array or { rows: [] }, got ${
      result === null ? "null" : typeof result
    }`,
  );
}

/** The first row, or undefined. Same normalisation. */
export function rawRow<T>(result: unknown): T | undefined {
  return rawRows<T>(result)[0];
}
