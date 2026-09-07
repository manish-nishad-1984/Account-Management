import { useRef, useState } from "react";
import { Download, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_FILES,
  attachmentRejection,
  formatBytes,
  type InwardChallanDocument,
} from "@accountmanagement/contracts";
import { Alert, Button } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import {
  downloadChallanDocument,
  useAttachChallanDocuments,
  useDetachChallanDocument,
} from "./api";

/**
 * The attachment list on a saved challan: add, download, remove.
 *
 * The legacy screen has a `multiple` file picker and a list of names, and the
 * names are all it has — the files themselves are anonymously downloadable from
 * `wwwroot/Content/InWordDocument/` by anyone who guesses one (finding H-9).
 * Here a download is a request that carried a token and passed
 * `inward-challan.view`, which is why it goes through `fetch` and an object URL
 * rather than an anchor: the token lives in memory, so a plain link would arrive
 * with no credentials at all.
 */
export function ChallanAttachments({
  challanId,
  documents,
  canEdit = true,
}: {
  challanId: string;
  documents: InwardChallanDocument[];
  canEdit?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const attach = useAttachChallanDocuments();
  const detach = useDetachChallanDocument();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const onPick = async (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;

    const chosen = Array.from(files);

    // Checked here with the SAME rules the server uses, from the contracts
    // package. A client-side check that disagrees with the server either blocks
    // a file the server would take or promises one it will refuse after the
    // upload has finished.
    const rejection = chosen.map((f) => attachmentRejection(f)).find(Boolean);
    if (rejection) {
      setError(rejection);
      reset();
      return;
    }
    if (chosen.length > ATTACHMENT_MAX_FILES) {
      setError(`At most ${ATTACHMENT_MAX_FILES} files can be attached in one go.`);
      reset();
      return;
    }

    try {
      await attach.mutateAsync({ id: challanId, files: chosen });
    } catch (cause) {
      setError(message(cause, "The files could not be attached."));
    } finally {
      reset();
    }
  };

  /** Clearing the input matters: picking the same file twice fires no change event. */
  const reset = () => {
    if (input.current) input.current.value = "";
  };

  const onDownload = async (document: InwardChallanDocument) => {
    setError(null);
    setBusyId(document.id);
    try {
      await downloadChallanDocument(challanId, document.id, document.documentName);
    } catch (cause) {
      setError(message(cause, `"${document.documentName}" could not be downloaded.`));
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (document: InwardChallanDocument) => {
    setError(null);
    setBusyId(document.id);
    try {
      await detach.mutateAsync({ id: challanId, documentId: document.id });
    } catch (cause) {
      setError(message(cause, `"${document.documentName}" could not be removed.`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing attached yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip aria-hidden className="size-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {document.documentName}
              </span>

              {document.sizeBytes !== null && (
                <span className="shrink-0 text-xs text-slate-400">
                  {formatBytes(document.sizeBytes)}
                </span>
              )}

              {document.isDownloadable ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 px-2 py-1"
                  loading={busyId === document.id}
                  icon={Download}
                  aria-label={`Download ${document.documentName}`}
                  onClick={() => void onDownload(document)}
                />
              ) : (
                /* An ETL row: the source recorded a name and left the file on
                   its own web server. Saying so beats a download that 404s. */
                <span
                  className="shrink-0 text-xs text-slate-400"
                  title="Recorded by the old system, which kept the file on its own web server"
                >
                  on the old server
                </span>
              )}

              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 px-2 py-1 text-rose-600 hover:bg-rose-50"
                  icon={Trash2}
                  aria-label={`Remove ${document.documentName}`}
                  disabled={busyId === document.id}
                  onClick={() => void onRemove(document)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="sr-only"
            aria-label="Choose files to attach"
            onChange={(event) => void onPick(event.target.files)}
          />
          <Button
            type="button"
            variant="secondary"
            icon={attach.isPending ? undefined : Upload}
            loading={attach.isPending}
            onClick={() => input.current?.click()}
          >
            {attach.isPending ? "Uploading…" : "Attach files"}
          </Button>
          <span className="text-xs text-slate-500">
            PDF, images, Office or CSV. Up to 10 MB each.
          </span>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

/**
 * Files chosen BEFORE the challan exists.
 *
 * A challan has to be saved before anything can hang off it, so on a new challan
 * the files are held here and uploaded once the save returns an id. The queue is
 * shown so nobody is left wondering whether the picker did anything.
 */
export function QueuedAttachments({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = (picked: FileList | null) => {
    setError(null);
    if (!picked) return;

    const chosen = [...files, ...Array.from(picked)];
    const rejection = chosen.map((f) => attachmentRejection(f)).find(Boolean);
    if (rejection) {
      setError(rejection);
    } else if (chosen.length > ATTACHMENT_MAX_FILES) {
      setError(`At most ${ATTACHMENT_MAX_FILES} files can be attached in one go.`);
    } else {
      onChange(chosen);
    }

    if (input.current) input.current.value = "";
  };

  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip aria-hidden className="size-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-slate-700">{file.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                className="shrink-0 px-2 py-1 text-rose-600 hover:bg-rose-50"
                icon={Trash2}
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="sr-only"
          aria-label="Choose files to attach"
          onChange={(event) => onPick(event.target.files)}
        />
        <Button type="button" variant="secondary" icon={Upload} onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <span className="text-xs text-slate-500">
          Uploaded when the challan is saved. PDF, images, Office or CSV, up to 10 MB each.
        </span>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

/** A spinner for the moment between the challan being saved and its files landing. */
export function UploadingNotice({ count }: { count: number }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 aria-hidden className="size-3.5 animate-spin" />
      Uploading {count} {count === 1 ? "file" : "files"}…
    </p>
  );
}

/** The server's sentence if it sent one, because it names the file and the rule. */
const message = (cause: unknown, fallback: string): string =>
  cause instanceof ApiError && cause.message ? cause.message : fallback;
