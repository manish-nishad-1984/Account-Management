import { ConflictException } from "@nestjs/common";

/**
 * Turns a PostgreSQL constraint violation into an HTTP 409 that names the field.
 *
 * The database is the only place a uniqueness rule can be enforced without a
 * race. Checking "does a company with this GST already exist?" and then
 * inserting is two statements with a gap in the middle, and two requests in that
 * gap both see nothing and both insert — which is how the source ends up with
 * duplicate group names despite `Any(x => x.GroupName == name)` guarding them
 * (`SiteMasterRepo.cs`).
 *
 * So the write path does not pre-check. It inserts, lets the unique index refuse,
 * and translates the refusal here. The rule lives in one place and holds under
 * concurrency.
 */

/**
 * Constraint name to the message a person should see.
 *
 * Keyed by the index names in the migrations. A constraint that is not listed
 * falls through to a generic conflict rather than leaking the index name — but
 * every constraint a write endpoint can actually hit should be listed, because
 * "already exists" without saying what does is barely better than a 500.
 */
const CONFLICT_MESSAGES: Record<string, { field: string; message: string }> = {
  companies_gst_no_key: {
    field: "gstNo",
    message: "Another company is already registered with this GST number",
  },
  users_user_name_lower_key: {
    field: "userName",
    message: "That username is taken. Usernames are matched without regard to case",
  },
  site_groups_name_lower_key: {
    field: "name",
    message: "A site group with this name already exists",
  },
  suppliers_gst_no_key: {
    field: "gstNo",
    message: "Another supplier is already registered with this GST number",
  },
  suppliers_name_lower_key: {
    field: "name",
    message: "A supplier with this name already exists",
  },
  items_name_lower_key: {
    field: "name",
    message: "An item with this name already exists",
  },
  units_name_lower_key: {
    field: "name",
    message: "A unit with this name already exists",
  },
};

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

interface PostgresError {
  code?: string;
  constraint_name?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Finds the driver error, which is usually not the error that was thrown.
 *
 * Drizzle wraps every failure in a `DrizzleQueryError` — "Failed query: insert
 * into …" — and hangs the real one off `cause`. Reading `code` from the top-level
 * error therefore finds nothing, falls through, and turns every constraint
 * violation into a 500. That is precisely what happened the first time this ran:
 * a duplicate supplier name returned "Internal server error" while the code
 * below was, in isolation, correct.
 *
 * The chain is walked rather than unwrapped once, because the depth is not part
 * of Drizzle's contract and a driver may wrap again.
 */
const asPostgresError = (error: unknown): PostgresError | null => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof (current as PostgresError).code === "string") {
      return current as PostgresError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
};

/**
 * The constraint name arrives under different keys depending on the driver:
 * postgres.js uses `constraint_name`, PGlite uses `constraint`. Tests run on
 * PGlite and production on postgres.js, so reading only one of them would give a
 * helpful message in exactly the environment that does not need it.
 */
const constraintNameOf = (error: PostgresError): string | undefined =>
  error.constraint_name ?? error.constraint;

/**
 * Rethrows a unique violation as a 409 whose `issues` array matches the shape
 * ZodValidationPipe produces, so the client can attach it to the offending field
 * without caring whether the rejection came from Zod or from PostgreSQL.
 */
export function rethrowConflict(error: unknown): never {
  const pgError = asPostgresError(error);

  if (pgError?.code === UNIQUE_VIOLATION) {
    const known = CONFLICT_MESSAGES[constraintNameOf(pgError) ?? ""];
    throw new ConflictException({
      message: known?.message ?? "That value is already in use",
      issues: known ? [{ path: known.field, message: known.message }] : undefined,
    });
  }

  if (pgError?.code === FOREIGN_KEY_VIOLATION) {
    throw new ConflictException({
      message: "That record refers to something that does not exist, or is still in use",
    });
  }

  throw error;
}

/** Runs a write, translating constraint violations on the way out. */
export async function writing<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    rethrowConflict(error);
  }
}
