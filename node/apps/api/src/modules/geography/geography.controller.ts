import { Controller, Get, Inject, Query } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { CityOption, StateOption } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { cities, states } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";

/**
 * States and cities, for address pickers.
 *
 * NO `@Permissions`, like `sites/assignable`: this is public reference data —
 * the 35 states and 603 cities of India — and any form with an address needs
 * it whoever is filling it in. It still requires a signed-in caller; the
 * global AuthGuard is default-deny.
 */
class GeographyReader extends BaseRepository {
  states(): Promise<StateOption[]> {
    return this.db.select({ id: states.id, name: states.name }).from(states).orderBy(asc(states.name));
  }

  cities(stateId: number): Promise<CityOption[]> {
    return this.db
      .select({ id: cities.id, name: cities.name, stateId: cities.stateId })
      .from(cities)
      .where(eq(cities.stateId, stateId))
      .orderBy(asc(cities.name));
  }
}

const citiesQuerySchema = z.object({ stateId: z.coerce.number().int().positive() });

@Controller("geography")
export class GeographyController {
  private readonly reader: GeographyReader;

  constructor(@Inject(DATABASE) database: Database | null) {
    this.reader = new GeographyReader(database);
  }

  @Get("states")
  states(): Promise<StateOption[]> {
    return this.reader.states();
  }

  /** Always for ONE state: 603 cities in one dropdown is not a picker. */
  @Get("cities")
  cities(@Query(new ZodValidationPipe(citiesQuerySchema)) query: { stateId: number }): Promise<CityOption[]> {
    return this.reader.cities(query.stateId);
  }
}
