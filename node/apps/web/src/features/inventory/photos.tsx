import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Camera, ImageOff, Loader2, X } from "lucide-react";
import { Modal } from "../../components/ui";
import { ApiError, downloadRequest } from "../../lib/api-client";
import { uploadInventoryPhoto } from "./stock-api";

/**
 * A photo the API serves behind sign-in: fetched with the token and shown from
 * memory, since an <img src> cannot carry it. A click opens it large.
 */
export function AuthedPhoto({ path, alt, className }: { path: string; alt: string; className?: string }) {
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
          setLarge(true);
        }}
        className="shrink-0"
        aria-label={`Show the photo of ${alt}`}
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
 * Take or choose a photo (client, 26 Oct 2026). On a phone it opens the camera.
 * The photo is uploaded as soon as it is chosen; the form gets its key.
 */
export function PhotoInput({
  label,
  onChange,
  currentPath,
}: {
  label: string;
  /** The key of the photo uploaded; null when it is taken off. */
  onChange: (photoKey: string | null) => void;
  /** The photo there already is, to show until another is chosen. */
  currentPath?: string | null;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { photoKey } = await uploadInventoryPhoto(file);
      setPreview(URL.createObjectURL(file));
      onChange(photoKey);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The photo could not be uploaded.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {preview ? (
          <span className="relative">
            <img src={preview} alt={label} className="size-16 rounded object-cover ring-1 ring-slate-200" />
            <button
              type="button"
              aria-label="Take the photo off"
              onClick={() => {
                setPreview(null);
                onChange(null);
              }}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-slate-600 shadow ring-1 ring-slate-200 hover:text-rose-700"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ) : currentPath ? (
          <AuthedPhoto path={currentPath} alt={label} className="size-16" />
        ) : null}
        <label
          className={clsx(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
            busy && "pointer-events-none opacity-60",
          )}
        >
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Camera aria-hidden className="size-4" />}
          {busy ? "Uploading…" : preview || currentPath ? "Change photo" : "Take or choose photo"}
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
      </div>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}
