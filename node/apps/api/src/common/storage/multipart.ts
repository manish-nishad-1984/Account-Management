import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  formatBytes,
} from "@accountmanagement/contracts";
import type { FastifyRequest } from "fastify";
import type {} from "@fastify/multipart";

/**
 * Reads the files out of a multipart request, into memory.
 *
 * IN MEMORY, DELIBERATELY, and only because the per-file cap is 10 MB and the
 * per-request cap is ten of them. Buffering is what lets the bytes be inspected
 * (`file-type.ts`) BEFORE anything is written to disk, so a refused upload never
 * exists as a file — a temp file written first and deleted on rejection is a
 * window, and it is the window that the failure path forgets to close. If the
 * limits ever rise past a few hundred MB this must stream to the storage driver
 * instead, and the driver's interface already allows for it.
 *
 * THE ITERATOR MUST BE DRAINED. `@fastify/multipart` reads parts from the
 * request stream on demand; abandoning it half way leaves the connection with an
 * unconsumed body and the request hangs until the client or the proxy gives up.
 * So every part is consumed even after a validation failure has been decided,
 * and the error is raised at the end.
 */

export interface UploadedFile {
  /** As the client named it, unsanitised — the caller must clean it. */
  fileName: string;
  bytes: Buffer;
}

export async function readUploads(request: FastifyRequest): Promise<UploadedFile[]> {
  // `isMultipart` and `files` are added to every request by the plugin, and its
  // type augmentation only exists in a program that imports it — hence the
  // type-only import above, which no bundler emits and no runtime sees.
  const multipart = request;

  if (typeof multipart.isMultipart !== "function" || !multipart.isMultipart()) {
    throw new BadRequestException(
      "Send the file as multipart/form-data with a field named 'files'.",
    );
  }

  const files: UploadedFile[] = [];
  let failure: Error | null = null;

  try {
    for await (const part of multipart.files({
      limits: { fileSize: ATTACHMENT_MAX_BYTES, files: ATTACHMENT_MAX_FILES },
    })) {
      let bytes: Buffer;
      try {
        bytes = await part.toBuffer();
      } catch (error) {
        // Record and keep draining. Throwing here would abandon the stream.
        failure ??= translate(error, part.filename);
        continue;
      }
      if (!failure) {
        files.push({ fileName: part.filename, bytes });
      }
    }
  } catch (error) {
    failure ??= translate(error);
  }

  if (failure) {
    throw failure;
  }

  if (files.length === 0) {
    throw new BadRequestException("No file was sent.");
  }

  return files;
}

/**
 * The plugin's errors, in words that name the limit that was hit.
 *
 * "Request body is too large" tells a user nothing about which file or what the
 * cap is, and the cap is a number they can act on.
 */
function translate(error: unknown, fileName?: string): Error {
  const code = (error as { code?: string } | null)?.code;
  const named = fileName ? `"${fileName}"` : "That file";

  if (code === "FST_REQ_FILE_TOO_LARGE") {
    return new PayloadTooLargeException(
      `${named} is larger than the ${formatBytes(ATTACHMENT_MAX_BYTES)} limit.`,
    );
  }
  if (code === "FST_FILES_LIMIT") {
    return new BadRequestException(
      `At most ${ATTACHMENT_MAX_FILES} files can be attached in one go.`,
    );
  }
  if (code === "FST_PARTS_LIMIT" || code === "FST_FIELDS_LIMIT") {
    return new BadRequestException("Too many parts in the upload.");
  }
  if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
    return new BadRequestException("Send the file as multipart/form-data.");
  }
  return error instanceof Error ? error : new BadRequestException("The upload could not be read.");
}
