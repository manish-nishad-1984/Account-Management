import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DOCUMENT_STORAGE,
  StoredObjectMissingError,
  newStorageKey,
  safeFileName,
  type DocumentStorage,
} from "../../common/storage/document-storage";
import { decideContentType } from "../../common/storage/file-type";
import type { UploadedFile } from "../../common/storage/multipart";

/** Where the inventory's photos live in document storage: items, arrivals and agency persons. */
const PREFIX = "inventory";

/**
 * The inventory's photos (client, 26 Oct 2026): of an item, of what arrived,
 * of the person an item was given to. Uploaded first, on their own, so a phone
 * on a slow line is not holding the whole form; the form then names the photo
 * by the key handed back. Read back only through the record that holds it.
 */
@Injectable()
export class InventoryPhotosService {
  constructor(@Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage) {}

  async save(upload: UploadedFile): Promise<string> {
    const name = safeFileName(upload.fileName, "photo.jpg");
    const decision = decideContentType(name, upload.bytes);
    if (!decision.accepted) throw new BadRequestException(decision.reason);
    if (!decision.contentType.startsWith("image/")) {
      throw new BadRequestException("Send a photo: a JPG, PNG or WebP image.");
    }
    const key = newStorageKey(PREFIX, name);
    await this.storage.put(key, upload.bytes);
    return key;
  }

  /** The photo's bytes and the type they are, sniffed again rather than trusted from anywhere. */
  async read(key: string | null): Promise<{ bytes: Buffer; contentType: string }> {
    if (!key) throw new NotFoundException("No photo");
    try {
      const bytes = await this.storage.get(key);
      const decision = decideContentType(key, bytes);
      return { bytes, contentType: decision.accepted ? decision.contentType : "application/octet-stream" };
    } catch (error) {
      if (error instanceof StoredObjectMissingError) throw new NotFoundException("The photo is missing from storage.");
      throw error;
    }
  }

  /** A key handed out by `save`, and only such a key, may be written on a record. */
  async assertUploaded(key: string | null | undefined): Promise<void> {
    if (!key) return;
    if (!key.startsWith(`${PREFIX}/`) || !(await this.storage.exists(key))) {
      throw new BadRequestException("The photo was not uploaded. Choose it again.");
    }
  }
}
