import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Camera, Download, Loader2, Paperclip, RotateCcw, Trash2, Upload } from "lucide-react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_FILES,
  attachmentRejection,
  formatBytes,
  type InwardChallanDocument,
} from "@accountmanagement/contracts";
import {
  Alert,
  Button,
  IconButton,
  Modal,
} from "../../components/ui";
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

  const onFiles = async (chosen: File[]) => {
    setError(null);
    if (chosen.length === 0) return;

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
                <IconButton
                  label={`Remove ${document.documentName}`}
                  icon={Trash2}
                  tone="destructive"
                  size="sm"
                  onClick={() => void onRemove(document)}
                  disabled={busyId === document.id}
                  className="shrink-0"
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
            onChange={(event) => void onFiles(Array.from(event.target.files ?? []))}
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
          <CameraCaptureButton onCapture={(file) => void onFiles([file])} disabled={attach.isPending} />
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

  const onFiles = (picked: File[]) => {
    setError(null);
    if (picked.length === 0) return;

    const chosen = [...files, ...picked];
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
              <IconButton
                label={`Remove ${file.name}`}
                icon={Trash2}
                tone="destructive"
                size="sm"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="shrink-0"
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
          onChange={(event) => onFiles(Array.from(event.target.files ?? []))}
        />
        <Button type="button" variant="outline" icon={Upload} onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <CameraCaptureButton onCapture={(file) => onFiles([file])} />
        <span className="text-xs text-slate-500">
          Uploaded when the challan is saved. PDF, images, Office or CSV, up to 10 MB each.
        </span>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

/**
 * "Take photo", next to the file picker wherever a challan takes attachments
 * (client request, 29 Sep 2026).
 *
 * A challan is very often keyed standing at the gate with the paper right
 * there, and leaving the app for the phone's own camera, taking the shot, and
 * coming back to find it in a file picker is three screens for one
 * photograph. This opens a camera in place instead.
 *
 * The captured frame becomes a real `File` — `image/jpeg`, from `canvas.toBlob`
 * — and is handed to the SAME `onFiles`/`onChange` path a picked file goes
 * through. A capture is not a second, trusted way in: it gets the same
 * extension, size and signature checks as anything chosen from disk.
 */
function CameraCaptureButton({
  onCapture,
  disabled,
}: {
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" icon={Camera} disabled={disabled} onClick={() => setOpen(true)}>
        Take photo
      </Button>
      {open && (
        <CameraCaptureDialog
          onCapture={(file) => {
            onCapture(file);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The live feed, a Capture button, and a preview to retake or keep.
 *
 * Mounted only while `open` — the camera is never asked for, and its light
 * never comes on, until someone actually clicks "Take photo".
 */
function CameraCaptureDialog({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot open the camera. Choose a file instead.");
      return;
    }

    navigator.mediaDevices
      // The REAR camera on a phone, where there is one — the gate pass being
      // photographed faces away from the screen. Desktop webcams have no
      // "environment" facing side, so `ideal` rather than `exact` falls back
      // to whatever camera exists instead of refusing to open at all.
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((media) => {
        if (cancelled) {
          // The dialog closed while the permission prompt was still up — do
          // not leave a camera running behind a component that is gone.
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          // Caught, not thrown: a blocked autoplay here would otherwise be an
          // unhandled rejection rather than the dialog's own error state, and
          // `onLoadedMetadata` is what actually gates the Capture button.
          video.current.play().catch(() => undefined);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Camera access was refused. Allow it for this site, or choose a file instead."
            : cause instanceof DOMException && cause.name === "NotFoundError"
              ? "No camera was found on this device."
              : "The camera could not be opened. Choose a file instead.",
        );
      });

    return () => {
      cancelled = true;
      // Stopping every track is what turns the camera light off. Closing the
      // dialog without this leaves it recording with nothing on screen for it.
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, []);

  // The object URL for a captured frame is revoked when it is replaced or the
  // dialog closes, or each Retake leaks the previous frame.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const capture = () => {
    const el = video.current;
    if (!el || el.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) setShot({ blob, url: URL.createObjectURL(blob) });
      },
      "image/jpeg",
      0.92,
    );
  };

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  };

  const use = () => {
    if (!shot) return;
    onCapture(new File([shot.blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Take a photo"
      size="lg"
      footer={
        error ? (
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : shot ? (
          <>
            <Button type="button" variant="secondary" icon={RotateCcw} onClick={retake}>
              Retake
            </Button>
            <Button type="button" icon={Camera} onClick={use}>
              Use this photo
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" icon={Camera} disabled={!ready} onClick={capture}>
              Capture
            </Button>
          </>
        )
      }
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : (
        <div className="relative overflow-hidden rounded-lg bg-slate-900">
          {/* Both stay mounted once a frame is captured: hiding the video
              would stop the stream Retake captures from, and it costs
              nothing to keep playing behind the still. */}
          <video
            ref={video}
            className={clsx("aspect-[4/3] w-full object-cover", shot && "hidden")}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setReady(true)}
          />
          {shot && (
            <img
              src={shot.url}
              alt="Captured photo, not yet attached"
              className="aspect-[4/3] w-full object-cover"
            />
          )}
          {!ready && !shot && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-300">
              Starting camera…
            </p>
          )}
        </div>
      )}
    </Modal>
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
