import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ATTACHMENT_MAX_FILES, attachmentRejection } from "@accountmanagement/contracts";
import {
  DOCUMENT_STORAGE,
  StoredObjectMissingError,
  newStorageKey,
  safeFileName,
  type DocumentStorage,
} from "../../common/storage/document-storage";
import { decideContentType } from "../../common/storage/file-type";
import type { UploadedFile } from "../../common/storage/multipart";
import { InwardChallansRepository } from "./inward-challans.repository";

/** Keys are namespaced by module, so a bucket listing is readable by a human. */
const PREFIX = "inward-challans";

/**
 * Attaching, reading back and removing a challan's documents.
 *
 * Separate from the controller because none of this is about HTTP, and separate
 * from the repository because none of it is about SQL — it is the ordering of a
 * write to two places that can fail independently, which is the only genuinely
 * interesting part of file upload.
 */
@Injectable()
export class InwardChallanDocumentsService {
  private readonly logger = new Logger(InwardChallanDocumentsService.name);

  constructor(
    private readonly challans: InwardChallansRepository,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  /**
   * Validates EVERY file, then writes them, then records them.
   *
   * The order is the point. Validating as we go would leave the first three
   * files of a five-file upload stored and the request rejected, so the user
   * retries and gets duplicates. Nothing is written until every file has passed.
   *
   * If a write fails part way, the bytes already written are removed before the
   * error is raised — a blob with no row is invisible, and invisible waste is
   * never reclaimed. Rows are inserted only after all the bytes are down, so a
   * row can never point at a file that was not written.
   */
  async attach(challanId: string, uploads: UploadedFile[], actorId: string): Promise<void> {
    await this.challans.assertExists(challanId);

    if (uploads.length > ATTACHMENT_MAX_FILES) {
      throw new BadRequestException(
        `At most ${ATTACHMENT_MAX_FILES} files can be attached in one go.`,
      );
    }

    const checked = uploads.map((upload) => {
      const documentName = safeFileName(upload.fileName);

      const rejection = attachmentRejection({
        name: documentName,
        size: upload.bytes.byteLength,
      });
      if (rejection) {
        throw new BadRequestException(rejection);
      }

      const decision = decideContentType(documentName, upload.bytes);
      if (!decision.accepted) {
        throw new BadRequestException(decision.reason);
      }

      return {
        documentName,
        contentType: decision.contentType,
        bytes: upload.bytes,
        // Generated here, never derived from the uploaded name. This is the
        // whole of finding H-10.
        storageKey: newStorageKey(`${PREFIX}/${challanId}`, documentName),
      };
    });

    const written: string[] = [];
    try {
      for (const file of checked) {
        const stored = await this.storage.put(file.storageKey, file.bytes);
        written.push(stored.key);
      }
    } catch (error) {
      await this.discard(written);
      throw error;
    }

    for (const file of checked) {
      await this.challans.addDocument(
        challanId,
        {
          documentName: file.documentName,
          storageKey: file.storageKey,
          contentType: file.contentType,
          sizeBytes: file.bytes.byteLength,
        },
        actorId,
      );
    }
  }

  /**
   * The bytes of one attachment, with the type it is to be served as.
   *
   * The content type comes off the ROW, where it was written from the sniffed
   * signature at upload — never from the request and never guessed here.
   */
  async read(
    challanId: string,
    documentId: string,
  ): Promise<{ documentName: string; contentType: string; bytes: Buffer }> {
    const document = await this.challans.findDocument(challanId, documentId);

    if (!document.storageKey) {
      // An ETL row: the source recorded the name and left the file on its own
      // web server. Saying so is more use than a bare 404.
      throw new NotFoundException(
        `"${document.documentName}" was recorded by the old system, which kept the ` +
          "file on its own web server. It has not been migrated.",
      );
    }

    try {
      const bytes = await this.storage.get(document.storageKey);
      return {
        documentName: document.documentName,
        contentType: document.contentType ?? "application/octet-stream",
        bytes,
      };
    } catch (error) {
      if (error instanceof StoredObjectMissingError) {
        // A row pointing at bytes that are gone is a real fault, not a user
        // error, and it stays in the log even though the caller gets a 404.
        this.logger.error(
          `Attachment ${documentId} on challan ${challanId} references missing storage key ${document.storageKey}`,
        );
        throw new NotFoundException("That attachment's file is missing from storage.");
      }
      throw error;
    }
  }

  /** Row first, then bytes. See `removeDocument` for why that way round. */
  async detach(challanId: string, documentId: string): Promise<void> {
    const storageKey = await this.challans.removeDocument(challanId, documentId);
    if (storageKey) {
      await this.discard([storageKey]);
    }
  }

  /**
   * Best-effort removal. A failure here is logged and swallowed deliberately:
   * the caller has already succeeded at the thing the user asked for, and
   * turning "the file is deleted but a stray blob remains" into an error would
   * tell them their delete failed when it did not.
   */
  private async discard(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.remove(key);
      } catch (error) {
        this.logger.warn(
          `Could not remove stored object ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
