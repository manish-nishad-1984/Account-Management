import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import type {
  ClientDetail,
  CreateClient,
  ListQuery,
  SortDirection,
  UpdateClient,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { clientIncomes, clients, clientSites } from "../../db/schema";
import { decodeCursor, keysetOrder, keysetWhere, toPage } from "../../common/keyset";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

const SORTABLE = { name: clients.name, createdAt: clients.createdAt } as const;
type ClientSortKey = keyof typeof SORTABLE;

export interface ClientListRow {
  id: string;
  name: string;
  mobile: string | null;
  email: string | null;
  gstNo: string | null;
  panNo: string | null;
  siteNames: string[];
}

export interface ClientFilters {
  /** Only the clients that pay for this project. */
  siteId?: string;
}

/**
 * The Client Master: who pays us for a project. Soft delete, like the other masters.
 */
@Injectable()
export class ClientsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  private where(search: string | undefined, options: ClientFilters) {
    const filters = [eq(clients.isDeleted, false)];
    if (search) {
      const pattern = `%${search}%`;
      filters.push(
        or(
          ilike(clients.name, pattern),
          ilike(clients.mobile, pattern),
          ilike(clients.gstNo, pattern),
          ilike(clients.panNo, pattern),
        )!,
      );
    }
    if (options.siteId) {
      filters.push(
        sql`exists (select 1 from ${clientSites} cs where cs.client_id = ${clients.id} and cs.site_id = ${options.siteId})`,
      );
    }
    return filters;
  }

  async list(
    query: ListQuery,
    options: ClientFilters = {},
  ): Promise<{ rows: ClientListRow[]; nextCursor: string | null }> {
    const sortKey: ClientSortKey =
      query.sortBy && query.sortBy in SORTABLE ? (query.sortBy as ClientSortKey) : "name";
    const sortColumn = SORTABLE[sortKey];
    const direction: SortDirection = query.sortDir;

    const filters = this.where(query.search, options);
    const seek = keysetWhere(sortColumn, clients.id, direction, query.cursor ? decodeCursor(query.cursor) : null);
    if (seek) filters.push(seek);

    const rows = await this.db
      .select({
        id: clients.id,
        name: clients.name,
        mobile: clients.mobile,
        email: clients.email,
        gstNo: clients.gstNo,
        panNo: clients.panNo,
        siteNames: sql<string[]>`(
          select coalesce(array_agg(s.name order by s.name), '{}')
          from client_sites cs join sites s on s.id = cs.site_id
          where cs.client_id = clients.id
        )`,
        sortValue: sql<string>`${sortColumn}::text`,
      })
      .from(clients)
      .where(and(...filters))
      .orderBy(...keysetOrder(sortColumn, clients.id, direction))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit, (row) => ({ value: row.sortValue, id: row.id }));
    return {
      rows: page.rows.map(({ sortValue: _ignored, ...row }) => row),
      nextCursor: page.nextCursor,
    };
  }

  async total(search?: string, options: ClientFilters = {}): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(clients)
      .where(and(...this.where(search, options)));
    return row?.value ?? 0;
  }

  async findById(id: string): Promise<ClientDetail> {
    const [row] = await this.db
      .select({
        id: clients.id,
        name: clients.name,
        mobile: clients.mobile,
        email: clients.email,
        gstNo: clients.gstNo,
        panNo: clients.panNo,
        address: clients.address,
      })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.isDeleted, false)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Client not found");
    }
    const linked = await this.db
      .select({ siteId: clientSites.siteId })
      .from(clientSites)
      .where(eq(clientSites.clientId, id));
    return { ...row, siteIds: linked.map((one) => one.siteId) };
  }

  async create(input: CreateClient, actorId: string): Promise<ClientDetail> {
    const { siteIds, ...fields } = input;
    const id = await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(clients)
          .values({ ...normalise(fields), ...createdBy(actorId) })
          .returning({ id: clients.id });
        if (siteIds.length > 0) {
          await tx
            .insert(clientSites)
            .values([...new Set(siteIds)].map((siteId) => ({ clientId: row!.id, siteId })));
        }
        return row!.id;
      }),
    );
    return this.findById(id);
  }

  /** Only the keys present are written; `siteIds`, when present, replaces the links. */
  async update(id: string, input: UpdateClient, actorId: string): Promise<ClientDetail> {
    const { siteIds, ...fields } = input;
    await writing(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(clients)
          .set({ ...normalise(fields), ...updatedBy(actorId) })
          .where(and(eq(clients.id, id), eq(clients.isDeleted, false)))
          .returning({ id: clients.id });
        if (!row) {
          throw new NotFoundException("Client not found");
        }
        if (siteIds) {
          await tx.delete(clientSites).where(eq(clientSites.clientId, id));
          if (siteIds.length > 0) {
            await tx
              .insert(clientSites)
              .values([...new Set(siteIds)].map((siteId) => ({ clientId: id, siteId })));
          }
        }
      }),
    );
    return this.findById(id);
  }

  /** Refused while income is recorded against the client: the history must keep a name. */
  async remove(id: string, actorId: string): Promise<void> {
    const [used] = await this.db
      .select({ value: count() })
      .from(clientIncomes)
      .where(and(eq(clientIncomes.clientId, id), eq(clientIncomes.isDeleted, false)));
    const entries = used?.value ?? 0;
    if (entries > 0) {
      throw new ConflictException(
        `Income is recorded against this client (${entries} ${entries === 1 ? "entry" : "entries"}). It cannot be deleted.`,
      );
    }
    const [row] = await this.db
      .update(clients)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(and(eq(clients.id, id), eq(clients.isDeleted, false)))
      .returning({ id: clients.id });
    if (!row) {
      throw new NotFoundException("Client not found");
    }
  }
}

function normalise<T extends { gstNo?: string | null; panNo?: string | null }>(input: T): T {
  const patch: Record<string, unknown> = { ...input };
  for (const key of ["gstNo", "panNo"] as const) {
    if (typeof patch[key] === "string") patch[key] = (patch[key] as string).toUpperCase();
  }
  return patch as T;
}
