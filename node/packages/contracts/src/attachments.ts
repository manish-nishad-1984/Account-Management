import { z } from "zod";

/**
 * What may be attached to a document, shared by the API and the browser.
 *
 * ONE list, in the contracts package, because a client-side check that is
 * stricter or laxer than the server's is worse than no client-side check: it
 * either blocks a file the server would take, or promises one it will refuse
 * after the user has waited for the upload.
 *
 * The server enforces this. The browser uses it to say so early and to set the
 * `accept` attribute on the file input.
 */

/**
 * 10 MB per file.
 *
 * A phone photograph of a delivery note is 2-5 MB, and a scanned multi-page
 * challan around 1 MB, so this clears the real cases with room. The legacy
 * system has NO limit of any kind — `IFormFile.CopyTo` on whatever arrives — so
 * a single upload can fill the web server's disk, which is also where the app
 * runs.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Per request, not per document. The legacy screen's picker is `multiple`. */
export const ATTACHMENT_MAX_FILES = 10;

/**
 * Extension -> the content type it will be SERVED as.
 *
 * An allowlist, not a blocklist: a blocklist is a list of the attacks that were
 * thought of. Everything here is inert in a browser tab, and the download
 * endpoint sends it as an attachment with `nosniff` regardless, so even a file
 * whose bytes are a lie cannot execute on this origin.
 *
 * `.html`, `.svg` and `.xml` are absent DELIBERATELY. All three script in a
 * browser, and an `.svg` served inline is a stored XSS on the application's own
 * origin with the victim's session attached. `.svg` is the one that looks
 * harmless and is not.
 */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** For a file input's `accept`. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).join(",");

export const attachmentExtensions = (): string[] => Object.keys(ATTACHMENT_TYPES);

/** The extension of a file name, lower-cased, or "" — the same rule as the API's. */
export function attachmentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    return "";
  }
  const extension = fileName.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
}

export const isAllowedAttachment = (fileName: string): boolean =>
  attachmentExtension(fileName) in ATTACHMENT_TYPES;

/**
 * Why a file was refused, in words a user can act on — or null if it is fine.
 *
 * Returning the reason rather than a boolean means the browser and the server
 * say the same sentence, and nobody has to guess which rule they broke.
 */
export function attachmentRejection(file: { name: string; size: number }): string | null {
  if (!isAllowedAttachment(file.name)) {
    const extension = attachmentExtension(file.name);
    return extension
      ? `${extension} files cannot be attached. Allowed: ${attachmentExtensions().join(", ")}`
      : `"${file.name}" has no file extension, so it cannot be attached.`;
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(
      ATTACHMENT_MAX_BYTES,
    )}.`;
  }
  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }
  return null;
}

/** "2.4 MB". Display only. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One stored file, as every module that gains attachments will report it.
 *
 * `storageKey` is NOT here, and that is deliberate: it is a server-side
 * location, the browser has no use for it, and publishing it invites a client to
 * build its own URL from it. What the browser needs to know is whether there are
 * bytes to fetch, which is `isDownloadable`.
 */
export const attachmentSchema = z.object({
  id: z.string(),
  /** The name the user's file had. Display, and the download's filename. */
  documentName: z.string(),
  /** Null on rows carried from the source, which recorded a name and nothing else. */
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  /**
   * False for every row the ETL brings over: the source recorded a file NAME and
   * no location, and the bytes are on the old web server. The row is still shown
   * — the name is evidence a document existed — but there is nothing to fetch.
   */
  isDownloadable: z.boolean(),
  uploadedAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
