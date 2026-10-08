import { useCallback, useEffect, useState } from "react";
import type { PayoutListDetail } from "@accountmanagement/contracts";
import { Copy } from "lucide-react";
import { Alert, Button, Modal } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { usePayoutDetailLoader } from "./api";
import { renderPayoutImage } from "./image";
import { buildPayoutMessage } from "./message";

/**
 * Send / copy a saved list. Both need only `payout.view`: they read a list and
 * hand its text to the person, and change nothing.
 *
 * The app has no toast system, so the outcome is a short status line the screen
 * renders (`ShareNotice`) and that clears itself.
 */

type Notice = { tone: "success" | "danger"; text: string };

/** Clipboard API first; a hidden textarea for a page the browser will not allow it on (plain http, an old webview). */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission falls through to the legacy route below.
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const copied = document.execCommand("copy");
    box.remove();
    return copied;
  } catch {
    return false;
  }
}

/** The picture to the clipboard, so it can be pasted into a chat. False where the browser will not allow it. */
async function writeClipboardImage(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function usePayoutSharing() {
  const loader = usePayoutDetailLoader();
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** From a detail already in hand (the form), or by id (a grid row, where the row has no lines). */
  const resolve = useCallback(
    async (source: string | PayoutListDetail): Promise<PayoutListDetail | null> => {
      if (typeof source !== "string") return source;
      const cached = loader.cached(source);
      if (cached) return cached;
      try {
        return await loader.fetch(source);
      } catch (error) {
        setNotice({
          tone: "danger",
          text: error instanceof ApiError ? error.message : "Could not load this list to send it",
        });
        return null;
      }
    },
    [loader],
  );

  /**
   * THE LIST GOES OUT AS A PICTURE (client request, 6 and 8 Oct 2026).
   *
   * The owner forwards it to his boss, so the screen shows the picture and a
   * "Copy image" button: copied, it pastes into any chat. WhatsApp is not opened
   * from here - the person pastes where they like. Where the browser will not
   * put an image on the clipboard the picture is saved as a file instead.
   *
   * The picture is drawn here from the saved list and is not kept anywhere.
   */
  const [image, setImage] = useState<{ url: string; blob: Blob; name: string } | null>(null);

  const showImage = useCallback(
    async (source: string | PayoutListDetail) => {
      const detail = await resolve(source);
      if (!detail) return;
      try {
        const blob = await renderPayoutImage(detail);
        setImage({ url: URL.createObjectURL(blob), blob, name: `payout-list-${detail.listDate}.png` });
      } catch {
        setNotice({ tone: "danger", text: "Could not make the image in this browser. Use Copy text instead." });
      }
    },
    [resolve],
  );

  const closeImage = useCallback(() => setImage(null), []);

  useEffect(() => {
    const url = image?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);

  const copyImage = useCallback(async () => {
    if (!image) return;
    const copied = await writeClipboardImage(image.blob);
    if (!copied) download(image.blob, image.name);
    setNotice({
      tone: "success",
      text: copied
        ? "Image copied - paste it into the chat (Ctrl+V)."
        : "This browser would not copy the image, so it was saved to your downloads.",
    });
    if (copied) setImage(null);
  }, [image]);

  const copy = useCallback(
    async (source: string | PayoutListDetail) => {
      const detail = await resolve(source);
      if (!detail) return;
      const done = await writeClipboard(buildPayoutMessage(detail));
      setNotice(
        done
          ? { tone: "success", text: "List copied - paste it into WhatsApp or a message." }
          : { tone: "danger", text: "Could not copy automatically. Use the image button instead." },
      );
    },
    [resolve],
  );

  return { showImage, closeImage, copyImage, image, copy, prefetch: loader.prefetch, notice };
}

export function ShareNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div role="status" className="mb-3">
      <Alert tone={notice.tone === "success" ? "success" : "danger"}>{notice.text}</Alert>
    </div>
  );
}

/** The list's picture, large enough to read, with the one button that matters. */
export function PayoutImageDialog({ share }: { share: ReturnType<typeof usePayoutSharing> }) {
  const { image, closeImage, copyImage } = share;
  return (
    <Modal
      open={image !== null}
      onClose={closeImage}
      title="Payout list image"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={closeImage}>
            Close
          </Button>
          <Button icon={Copy} onClick={() => void copyImage()}>
            Copy image
          </Button>
        </>
      }
    >
      {image && <img src={image.url} alt="Payout list" className="mx-auto max-h-[70vh] w-full max-w-[560px] rounded border border-slate-200 object-contain" />}
    </Modal>
  );
}
