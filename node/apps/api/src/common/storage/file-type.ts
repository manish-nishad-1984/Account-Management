import { ATTACHMENT_TYPES, attachmentExtension } from "@accountmanagement/contracts";

/**
 * What a file ACTUALLY is, from its first bytes.
 *
 * The extension is a claim by whoever named the file and the upload's own
 * `Content-Type` header is a claim by the browser. Neither is evidence. This
 * reads the signature, which is the only part of an upload the sender cannot
 * make agreeable without also making the file genuinely that type.
 *
 * The point is NOT that a mislabelled file is dangerous here — the download
 * endpoint serves everything as an attachment with `nosniff`, so it is inert
 * either way. The point is that `report.html` renamed to `report.pdf` should be
 * refused at the door, with a sentence saying why, rather than stored for two
 * years and found by whoever eventually opens it.
 */

interface Signature {
  mime: string;
  /** Bytes that must match at `offset`. */
  magic: number[];
  offset?: number;
}

/** Ordered: the first match wins, so longer/more specific patterns come first. */
const SIGNATURES: Signature[] = [
  { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] }, // GIF8
  // RIFF....WEBP — the size sits between the two halves, so both are checked.
  { mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
  // ....ftypheic / ftypheix / ftypmif1
  { mime: "image/heic", magic: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  // Every OOXML file is a zip. Which OOXML it is cannot be told from the
  // signature, so the extension decides between .docx and .xlsx.
  { mime: "application/zip", magic: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/zip", magic: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
  // OLE2 compound document: legacy .doc and .xls.
  { mime: "application/x-ole-storage", magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

/** Signatures that mean "this is a document format we will not store". */
const REFUSED: Signature[] = [
  { mime: "application/x-dosexec", magic: [0x4d, 0x5a] }, // MZ — a Windows executable
  { mime: "application/x-elf", magic: [0x7f, 0x45, 0x4c, 0x46] }, // ELF
  { mime: "application/java-vm", magic: [0xca, 0xfe, 0xba, 0xbe] },
];

const matches = (bytes: Buffer, signature: Signature): boolean => {
  const offset = signature.offset ?? 0;
  if (bytes.length < offset + signature.magic.length) return false;
  return signature.magic.every((byte, i) => bytes[offset + i] === byte);
};

/** The detected type, or null when the bytes carry no signature we know. */
export function detectType(bytes: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (!matches(bytes, signature)) continue;
    if (signature.mime === "image/webp") {
      // RIFF is also WAV and AVI. The four bytes at offset 8 settle it.
      if (bytes.subarray(8, 12).toString("ascii") !== "WEBP") continue;
    }
    return signature.mime;
  }
  return null;
}

export function detectRefusedType(bytes: Buffer): string | null {
  return REFUSED.find((signature) => matches(bytes, signature))?.mime ?? null;
}

/**
 * Extensions whose files MUST carry a recognisable signature.
 *
 * A `.pdf` with no `%PDF` is not a PDF, whatever it is. `.txt`, `.csv` and
 * `.heic` are absent because plain text has no signature and a HEIC's varies;
 * requiring one there would refuse ordinary files.
 */
const SIGNATURE_REQUIRED: Readonly<Record<string, string[]>> = {
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".xlsx": ["application/zip"],
  ".docx": ["application/zip"],
  ".xls": ["application/x-ole-storage", "application/zip"],
  ".doc": ["application/x-ole-storage", "application/zip"],
};

/** Types every image extension is allowed to actually be. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic"];

/**
 * Accepted, or refused with a reason.
 *
 * Discriminated on `accepted` rather than on the presence of `reason`: an
 * optional-undefined field narrows unreliably once the value has been through a
 * `.map()`, and the caller then sees `string | undefined` where it knows it has
 * a string.
 */
export type ContentVerdict =
  | { accepted: true; contentType: string }
  | { accepted: false; reason: string };

/**
 * Decides what an upload is, or refuses it with a reason.
 *
 * A phone that writes a JPEG into a file called `.png` is a real and harmless
 * thing that happens constantly, so an extension/content mismatch WITHIN the
 * image formats is accepted and the file is simply served as what it is. A
 * mismatch across kinds — a zip called `.pdf`, a `.docx` that is really an
 * executable — is refused.
 */
export function decideContentType(fileName: string, bytes: Buffer): ContentVerdict {
  const extension = attachmentExtension(fileName);
  const claimed = ATTACHMENT_TYPES[extension];

  if (!claimed) {
    return {
      accepted: false,
      reason: `${extension || "That"} is not a file type that can be attached.`,
    };
  }

  const refused = detectRefusedType(bytes);
  if (refused) {
    return {
      accepted: false,
      reason: `"${fileName}" is a program, whatever it is named. It cannot be attached.`,
    };
  }

  const detected = detectType(bytes);
  const required = SIGNATURE_REQUIRED[extension];

  if (required) {
    if (detected === null) {
      return {
        accepted: false,
        reason:
          `"${fileName}" is not ${describe(claimed)}. ` +
          "Its name says one thing and its contents say another.",
      };
    }
    if (!required.includes(detected)) {
      // An image called by another image's name is fine — serve what it is.
      if (IMAGE_TYPES.includes(detected) && IMAGE_TYPES.includes(claimed)) {
        return { accepted: true, contentType: detected };
      }
      return {
        accepted: false,
        reason:
          `"${fileName}" is named as ${describe(claimed)} but its contents are ` +
          `${describe(detected)}.`,
      };
    }
  }

  // A zip signature cannot distinguish .docx from .xlsx, and text has none, so
  // the extension decides — which is safe, because both are on the allowlist.
  return { accepted: true, contentType: claimed };
}

const NAMES: Readonly<Record<string, string>> = {
  "application/pdf": "a PDF",
  "image/png": "a PNG image",
  "image/jpeg": "a JPEG image",
  "image/gif": "a GIF image",
  "image/webp": "a WebP image",
  "image/heic": "a HEIC image",
  "application/zip": "a zip archive",
  "application/x-ole-storage": "an older Office document",
  "text/plain": "plain text",
  "text/csv": "a CSV file",
};

const describe = (mime: string): string => NAMES[mime] ?? mime;
