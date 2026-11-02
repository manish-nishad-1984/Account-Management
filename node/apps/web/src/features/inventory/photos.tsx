import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Camera, Image as ImageIcon, ImageOff, Loader2, X } from "lucide-react";
import { Button, Modal } from "../../components/ui";
import { ApiError, downloadRequest } from "../../lib/api-client";
import { uploadInventoryPhoto } from "./stock-api";

/**
 * A photo the API serves behind sign-in: fetched with the token and shown from
 * memory, since an <img src> cannot carry it. A click opens it large.
 */
export function AuthedPhoto({
  path,
  alt,
  className,
  fill = false,
  onClick,
}: {
  path: string;
  alt: string;
  className?: string;
  /** As wide as its box - a card's photo - rather than its own size. */
  fill?: boolean;
  /** In place of showing it large: a card's photo opens the card's pieces. */
  onClick?: () => void;
}) {
  const [large, setLarge] = useState(false);
  const photo = useQuery({
    queryKey: ["photo", path],
    staleTime: 5 * 60_000,
    queryFn: async () => URL.createObjectURL(await downloadRequest(path)),
  });
  if (photo.isLoading) return <span className={clsx("inline-block animate-pulse rounded bg-slate-100", className)} />;
  if (!photo.data) {
    return (
      <span className={clsx("inline-flex items-center justify-center rounded bg-slate-50 text-slate-300", className)} title="Photo not available">
        <ImageOff aria-hidden className="size-4" />
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (onClick) onClick();
          else setLarge(true);
        }}
        className={clsx("shrink-0", fill && "block w-full")}
        aria-label={onClick ? `Open ${alt}` : `Show the photo of ${alt}`}
      >
        <img src={photo.data} alt={alt} className={clsx("rounded object-cover ring-1 ring-slate-200", className)} />
      </button>
      <Modal open={large} onClose={() => setLarge(false)} title={alt} size="lg">
        <img src={photo.data} alt={alt} className="mx-auto max-h-[70vh] rounded" />
      </Modal>
    </>
  );
}

/**
 * Take or choose a photo (client, 26 Oct 2026). Two ways in (client, 30 Oct
 * 2026): CAMERA takes one there and then - the webcam on a computer, the camera
 * on a phone - and GALLERY picks one already taken. The photo is uploaded as
 * soon as it is had; the form gets its key.
 */
export function PhotoInput({
  label,
  onChange,
  currentPath,
  hideLabel = false,
}: {
  label: string;
  /** The key of the photo uploaded; null when it is taken off. */
  onChange: (photoKey: string | null) => void;
  /** The photo there already is, to show until another is chosen. */
  currentPath?: string | null;
  /** In a row that says what the photo is already. */
  hideLabel?: boolean;
}) {
  const id = useId();
  const gallery = useRef<HTMLInputElement>(null);
  const phoneCamera = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webcam, setWebcam] = useState(false);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const choose = async (file: File | undefined | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { photoKey } = await uploadInventoryPhoto(file);
      setPreview(URL.createObjectURL(file));
      setRemoved(false);
      onChange(photoKey);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The photo could not be uploaded.");
    } finally {
      setBusy(false);
      for (const input of [gallery.current, phoneCamera.current]) if (input) input.value = "";
    }
  };

  // The browser's own view of the camera where it can show one; the phone's camera app where it cannot.
  const openCamera = () => {
    // `mediaDevices` is missing outside https, whatever the types say.
    if (typeof (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia === "function") setWebcam(true);
    else phoneCamera.current?.click();
  };

  const saved = removed ? null : (currentPath ?? null);
  const button =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50";

  return (
    <div>
      <span id={id} className={hideLabel ? "sr-only" : "mb-1.5 block text-sm font-medium text-slate-700"}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={id}>
        {(preview || saved) && (
          <span className="relative">
            {preview ? (
              <img src={preview} alt={label} className="size-12 rounded object-cover ring-1 ring-slate-200" />
            ) : (
              <AuthedPhoto path={saved!} alt={label} className="size-12" />
            )}
            <button
              type="button"
              aria-label={`Take the photo off: ${label}`}
              onClick={() => {
                setPreview(null);
                setRemoved(true);
                onChange(null);
              }}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-slate-600 shadow ring-1 ring-slate-200 hover:text-rose-700"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        )}
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Uploading…
          </span>
        ) : (
          <>
            <button type="button" className={button} onClick={openCamera} aria-label={`Camera: ${label}`}>
              <Camera aria-hidden className="size-4" /> Camera
            </button>
            <button type="button" className={button} onClick={() => gallery.current?.click()} aria-label={`Gallery: ${label}`}>
              <ImageIcon aria-hidden className="size-4" /> Gallery
            </button>
          </>
        )}
        <input
          ref={gallery}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="photo-gallery"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <input
          ref={phoneCamera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
      <WebcamDialog
        open={webcam}
        title={label}
        onClose={() => setWebcam(false)}
        onTaken={(photo) => {
          setWebcam(false);
          void choose(photo);
        }}
        onUnavailable={() => {
          // No camera the browser may use: the phone's own camera, or the file chooser.
          setWebcam(false);
          phoneCamera.current?.click();
        }}
      />
    </div>
  );
}

/** The webcam, live, with a button that takes the picture. */
function WebcamDialog({
  open,
  title,
  onClose,
  onTaken,
  onUnavailable,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onTaken: (photo: File) => void;
  onUnavailable: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;

  useEffect(() => {
    if (!open) return;
    let live: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((got) => {
        if (cancelled) {
          got.getTracks().forEach((track) => track.stop());
          return;
        }
        live = got;
        setStream(got);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const name = caught instanceof DOMException ? caught.name : "";
        if (name === "NotAllowedError") setError("The camera was not allowed. Allow it in the browser, or use Gallery.");
        else unavailable.current();
      });
    return () => {
      cancelled = true;
      live?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [open]);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);

  const take = () => {
    const frame = video.current;
    if (!frame || !frame.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = frame.videoWidth;
    canvas.height = frame.videoHeight;
    canvas.getContext("2d")?.drawImage(frame, 0, 0);
    canvas.toBlob((blob) => blob && onTaken(new File([blob], "camera.jpg", { type: "image/jpeg" })), "image/jpeg", 0.85);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Point the camera and take the photo"
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" icon={Camera} disabled={!stream} onClick={take}>
            Take photo
          </Button>
        </>
      }
    >
      {error ? (
        <p className="py-6 text-center text-sm text-rose-700">{error}</p>
      ) : (
        <video ref={video} autoPlay playsInline muted className="mx-auto max-h-[60vh] w-full rounded bg-slate-900" aria-label="Camera" />
      )}
    </Modal>
  );
}
