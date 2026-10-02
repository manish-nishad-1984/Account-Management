import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type {
  AgencyContact,
  AgencyContactInput,
  AgencyDetail,
  AgencySummary,
  CreateAgency,
  ListQuery,
  SortDirection,
  UpdateAgency,
  WorkType,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { agencies, agencyContacts, agencyWorkTypes, cities, states, workTypes } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = {
  name: agencies.name,
  createdAt: agencies.createdAt,
} as const;

type AgencySortKey = keyof typeof SORTABLE;

/** The list screen's three dropdowns. */
export interface AgencyFilters {
  workTypeId?: number;
  isActive?: boolean;
  cityId?: number;
}

export interface AgencyListRow {
  id: string;
  name: string;
  workTypes: WorkType[];
  cityName: string | null;
  stateName: string | null;
  primaryContactName: string | null;
  primaryContactMobile: string | null;
  isActive: boolean;
}

const DETAIL_COLUMNS = {
  id: agencies.id,
  name: agencies.name,
  address: agencies.address,
  stateId: agencies.stateId,
  cityId: agencies.cityId,
  gstNo: agencies.gstNo,
  panNo: agencies.panNo,
  bankName: agencies.bankName,
  accountNo: agencies.accountNo,
  ifscCode: agencies.ifscCode,
  accountHolderName: agencies.accountHolderName,
  isActive: agencies.isActive,
} as const;

@Injectable()
export class AgenciesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * What the mockup's search box promises: "agency name, contact, service".
   *
   * The two EXISTS reference the outer row as `${agencies}.id`, qualified —
   * Drizzle renders a bare column unqualified inside `sql`, and an unqualified
   * `id` binds to the subquery's own table and silently matches nothing (§7.1).
   */
  private where(search: string | undefined, filters: AgencyFilters): SQL[] {
    const where: SQL[] = [eq(agencies.isDeleted, false)];
    if (search) {
      const pattern = `%${search}%`;
      where.push(
        or(
          ilike(agencies.name, pattern),
          sql`exists (select 1 from ${agencyContacts} where ${agencyContacts.agencyId} = ${agencies}.id
                and (${agencyContacts.name} ilike ${pattern} or ${agencyContacts.mobile} ilike ${pattern}))`,
          sql`exists (select 1 from ${agencyWorkTypes} join ${workTypes} on ${workTypes.id} = ${agencyWorkTypes.workTypeId}
                where ${agencyWorkTypes.agencyId} = ${agencies}.id and ${workTypes.name} ilike ${pattern})`,
        )!,
      );
    }
    if (filters.workTypeId !== undefined) {
      where.push(
        sql`exists (select 1 from ${agencyWorkTypes} where ${agencyWorkTypes.agencyId} = ${agencies}.id
              and ${agencyWorkTypes.workTypeId} = ${filters.workTypeId})`,
      );
    }
    if (filters.isActive !== undefined) {
      where.push(eq(agencies.isActive, filters.isActive));
    }
    if (filters.cityId !== undefined) {
      where.push(eq(agencies.cityId, filters.cityId));
    }
    return where;
  }

  async list(
    query: ListQuery,
    filters: AgencyFilters = {},
  ): Promise<{ rows: AgencyListRow[]; nextCursor: string | null }> {
    const sortKey: AgencySortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as AgencySortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const where = this.where(query.search, filters);
    const seek = keysetWhere(sortColumn, agencies.id, direction, query.cursor ? decodeCursor(query.cursor) : null);
    if (seek) {
      where.push(seek);
    }

    const rows = await this.db
      .select({
        id: agencies.id,
        name: agencies.name,
        isActive: agencies.isActive,
        cityName: cities.name,
        stateName: states.name,
        primaryContactName: agencyContacts.name,
        primaryContactMobile: agencyContacts.mobile,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(agencies)
      .leftJoin(cities, eq(cities.id, agencies.cityId))
      .leftJoin(states, eq(states.id, agencies.stateId))
      // Line 1 is the primary contact.
      .leftJoin(agencyContacts, and(eq(agencyContacts.agencyId, agencies.id), eq(agencyContacts.lineNumber, 1)))
      .where(and(...where))
      .orderBy(...keysetOrder(sortColumn, agencies.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    const trades = await this.workTypesFor(page.rows.map((row) => row.id));

    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => ({ ...row, workTypes: trades.get(row.id) ?? [] })),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string, filters: AgencyFilters = {}): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(agencies)
      .where(and(...this.where(search, filters)));
    return row?.value ?? 0;
  }

  /** One query for the whole page, not one per row. */
  private async workTypesFor(agencyIds: string[]): Promise<Map<string, WorkType[]>> {
    const byAgency = new Map<string, WorkType[]>();
    if (agencyIds.length === 0) {
      return byAgency;
    }
    const rows = await this.db
      .select({ agencyId: agencyWorkTypes.agencyId, id: workTypes.id, name: workTypes.name })
      .from(agencyWorkTypes)
      .innerJoin(workTypes, eq(workTypes.id, agencyWorkTypes.workTypeId))
      .where(inArray(agencyWorkTypes.agencyId, agencyIds))
      .orderBy(asc(workTypes.name));
    for (const { agencyId, ...trade } of rows) {
      byAgency.set(agencyId, [...(byAgency.get(agencyId) ?? []), trade]);
    }
    return byAgency;
  }

  /** The tiles count every live agency, whatever the filters say. */
  async summary(): Promise<AgencySummary> {
    const [counts] = await this.db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${agencies.isActive})::int`,
      })
      .from(agencies)
      .where(eq(agencies.isDeleted, false));

    const used = await this.db
      .selectDistinct({ id: cities.id, name: cities.name })
      .from(agencies)
      .innerJoin(cities, eq(cities.id, agencies.cityId))
      .where(eq(agencies.isDeleted, false))
      .orderBy(asc(cities.name));

    const total = counts?.total ?? 0;
    const active = counts?.active ?? 0;
    return { total, active, inactive: total - active, cities: used };
  }

  async findById(id: string): Promise<AgencyDetail> {
    const [row] = await this.db
      .select(DETAIL_COLUMNS)
      .from(agencies)
      .where(and(eq(agencies.id, id), eq(agencies.isDeleted, false)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Agency not found");
    }

    const [trades, contacts] = await Promise.all([
      this.db
        .select({ id: agencyWorkTypes.workTypeId })
        .from(agencyWorkTypes)
        .where(eq(agencyWorkTypes.agencyId, id)),
      this.db
        .select({
          id: agencyContacts.id,
          name: agencyContacts.name,
          designation: agencyContacts.designation,
          mobile: agencyContacts.mobile,
          email: agencyContacts.email,
        })
        .from(agencyContacts)
        .where(eq(agencyContacts.agencyId, id))
        .orderBy(asc(agencyContacts.lineNumber)),
    ]);

    const [primary, ...additional] = contacts as AgencyContact[];
    return {
      ...row,
      workTypeIds: trades.map((trade) => trade.id).sort((a, b) => a - b),
      primaryContact: primary ?? null,
      additionalContacts: additional,
    };
  }

  async create(input: CreateAgency, actorId: string): Promise<AgencyDetail> {
    await this.checkReferences(input);
    const { workTypeIds, primaryContact, additionalContacts, ...columns } = input;
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(agencies)
          .values({ ...upperCased(columns), ...createdBy(actorId) })
          .returning({ id: agencies.id });
        const db = tx as unknown as Database;
        await this.writeWorkTypes(db, row!.id, workTypeIds);
        await this.writeContacts(db, row!.id, [primaryContact, ...additionalContacts]);
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  /**
   * Partial. Work types and contacts are each replaced only when sent; the
   * primary contact and the additional list are one stored list, so sending
   * either rewrites it, keeping whichever half was not sent as it is.
   */
  async update(id: string, input: UpdateAgency, actorId: string): Promise<AgencyDetail> {
    const current = await this.findById(id);
    await this.checkReferences({
      stateId: input.stateId ?? current.stateId,
      cityId: input.cityId ?? current.cityId,
      workTypeIds: input.workTypeIds,
    });
    const { workTypeIds, primaryContact, additionalContacts, ...columns } = input;

    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(agencies)
          .set({ ...upperCased(columns), ...updatedBy(actorId) })
          .where(and(eq(agencies.id, id), eq(agencies.isDeleted, false)))
          .returning({ id: agencies.id });
        if (!row) {
          throw new NotFoundException("Agency not found");
        }
        const db = tx as unknown as Database;
        if (workTypeIds !== undefined) {
          await this.writeWorkTypes(db, id, workTypeIds);
        }
        if (primaryContact !== undefined || additionalContacts !== undefined) {
          await this.writeContacts(db, id, [
            primaryContact ?? toInput(current.primaryContact),
            ...(additionalContacts ?? current.additionalContacts.map(toInput)),
          ].filter((contact): contact is AgencyContactInput => contact !== null));
        }
      }),
    );
    return this.findById(id);
  }

  /** Soft delete. Nothing references an agency yet; issues will, and get a check then. */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .update(agencies)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(agencies.id, id), eq(agencies.isDeleted, false)))
      .returning({ id: agencies.id });
    if (!row) {
      throw new NotFoundException("Agency not found");
    }
  }

  async listWorkTypes(): Promise<WorkType[]> {
    return this.db.select({ id: workTypes.id, name: workTypes.name }).from(workTypes).orderBy(asc(workTypes.name));
  }

  async createWorkType(name: string, actorId: string): Promise<WorkType> {
    const [row] = await writing(() =>
      this.db
        .insert(workTypes)
        .values({ name, ...createdBy(actorId) })
        .returning({ id: workTypes.id, name: workTypes.name }),
    );
    return row!;
  }

  /**
   * A city must be in the chosen state, and every work type must exist. Both
   * are foreign keys, but a key only says the row exists — not that Surat is in
   * Gujarat — and its violation would arrive as a generic 409.
   */
  private async checkReferences(input: { stateId?: number; cityId?: number; workTypeIds?: number[] }) {
    if (input.cityId !== undefined && input.stateId !== undefined) {
      const [city] = await this.db
        .select({ stateId: cities.stateId })
        .from(cities)
        .where(eq(cities.id, input.cityId))
        .limit(1);
      if (!city) {
        throw new BadRequestException({ message: "That city does not exist", issues: [{ path: "cityId", message: "Choose a city" }] });
      }
      if (city.stateId !== input.stateId) {
        throw new BadRequestException({
          message: "That city is not in the chosen state",
          issues: [{ path: "cityId", message: "That city is not in the chosen state" }],
        });
      }
    }
    if (input.workTypeIds && input.workTypeIds.length > 0) {
      const unique = [...new Set(input.workTypeIds)];
      const found = await this.db
        .select({ id: workTypes.id })
        .from(workTypes)
        .where(inArray(workTypes.id, unique));
      if (found.length !== unique.length) {
        throw new BadRequestException({
          message: "A chosen work type no longer exists",
          issues: [{ path: "workTypeIds", message: "A chosen work type no longer exists" }],
        });
      }
    }
  }

  private async writeWorkTypes(db: Database, agencyId: string, ids: number[]) {
    await db.delete(agencyWorkTypes).where(eq(agencyWorkTypes.agencyId, agencyId));
    const unique = [...new Set(ids)];
    if (unique.length > 0) {
      await db.insert(agencyWorkTypes).values(unique.map((workTypeId) => ({ agencyId, workTypeId })));
    }
  }

  /** Replaces the whole list; line 1 is the primary contact. */
  private async writeContacts(db: Database, agencyId: string, contacts: AgencyContactInput[]) {
    await db.delete(agencyContacts).where(eq(agencyContacts.agencyId, agencyId));
    if (contacts.length > 0) {
      await db.insert(agencyContacts).values(
        contacts.map((contact, index) => ({ agencyId, ...contact, lineNumber: index + 1 })),
      );
    }
  }
}

const toInput = (contact: AgencyContact | null): AgencyContactInput | null =>
  contact && {
    name: contact.name,
    designation: contact.designation,
    mobile: contact.mobile,
    email: contact.email,
  };

/** GST, PAN and IFSC are stored upper-cased, as on companies and suppliers. */
function upperCased<T extends Record<string, unknown>>(columns: T): T {
  const patch = { ...columns } as Record<string, unknown>;
  for (const key of ["gstNo", "panNo", "ifscCode"]) {
    if (typeof patch[key] === "string") {
      patch[key] = (patch[key] as string).toUpperCase();
    }
  }
  return patch as T;
}
