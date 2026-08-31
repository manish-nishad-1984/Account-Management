import { BadRequestException, Body, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body against a Zod schema and returns the PARSED value, so
 * handlers receive data that is typed and coerced rather than whatever arrived.
 *
 * The .NET API performed no server-side validation of any kind; models were bound
 * and persisted as sent. That is also why money totals computed in the browser
 * were trusted without check.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

/** `@ZodBody(schema)` — shorthand for `@Body(new ZodValidationPipe(schema))`. */
export const ZodBody = (schema: ZodSchema) => Body(new ZodValidationPipe(schema));
