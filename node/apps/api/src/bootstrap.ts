import multipart from "@fastify/multipart";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from "@accountmanagement/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/**
 * Everything that must happen to the app between `create` and `listen`.
 *
 * It exists so `main.ts` and the boot test cannot drift. Registering multipart
 * in `main.ts` alone would mean every test that boots the real module graph
 * serves upload routes that reject every upload — passing tests, broken
 * production, and the failure only visible by uploading a file.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  /**
   * Multipart, with limits set HERE rather than trusted to the route.
   *
   * These are the outer bound: the plugin aborts a stream that exceeds them
   * without buffering the rest, so a caller cannot make the process hold a
   * gigabyte by lying about `Content-Length`. `readUploads` passes the same
   * numbers again per request, which is belt and braces on purpose — this file
   * is easy to forget when adding a second upload route.
   *
   * The legacy application has no limit of any kind.
   */
  await app.register(multipart, {
    limits: {
      fileSize: ATTACHMENT_MAX_BYTES,
      files: ATTACHMENT_MAX_FILES,
      // A multipart body is not a place to send form fields to this API; the
      // JSON endpoints take those. Keeping the field allowance small means a
      // request cannot arrive as ten thousand tiny parts.
      fields: 10,
      parts: ATTACHMENT_MAX_FILES + 10,
    },
  });

  app.setGlobalPrefix("api/v1");
}
