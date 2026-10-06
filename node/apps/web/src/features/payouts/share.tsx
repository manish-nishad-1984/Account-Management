import { useCallback, useEffect, useState } from "react";
import type { PayoutListDetail } from "@accountmanagement/contracts";
import { Alert } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { usePayoutDetailLoader } from "./api";
import { renderPayoutImage } from "./image";
import { buildPayoutMessage, whatsAppUrl } from "./message";

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
   * THE LIST GOES OUT AS A PICTURE (client request, 6 Oct 2026).
   *
   * A `wa.me` link can carry text and nothing else, so an image cannot be
   * attached by link. Three routes, best first:
   *
   *  1. The share sheet with the image as a file - a phone, and some desktops -
   *     where the person picks WhatsApp and then the chat, the image already in it.
   *  2. Otherwise the image is put on the clipboard and WhatsApp is opened: the
   *     person picks the chat and presses paste.
   *  3. Failing that it is saved as a file to attach by hand.
   *
   * The picture is drawn here from the saved list and is not kept anywhere; if it
   * cannot be drawn at all, the text of the list is sent as it used to be.
   */
  const whatsApp = useCallback(
    async (source: string | PayoutListDetail) => {
      const detail = await resolve(source);
      if (!detail) return;
      const name = `payout-list-${detail.listDate}.png`;

      let blob: Blob;
      try {
        blob = await renderPayoutImage(detail);
      } catch {
        window.open(whatsAppUrl(buildPayoutMessage(detail)), "_blank", "noopener");
        setNotice({ tone: "danger", text: "Could not make the image here, so the list was sent as text." });
        return;
      }

      const file = new File([blob], name, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Payout list" });
          return;
        } catch (error) {
          // Closing the sheet is a choice, not a failure.
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }

      const copied = await writeClipboardImage(blob);
      if (!copied) download(blob, name);
      window.open("https://wa.me/", "_blank", "noopener");
      setNotice({
        tone: "success",
        text: copied
          ? "The list image is copied. Open the chat in WhatsApp and paste it (Ctrl+V)."
          : "The list image is saved to your downloads. Attach it in WhatsApp.",
      });
    },
    [resolve],
  );

  const copy = useCallback(
    async (source: string | PayoutListDetail) => {
      const detail = await resolve(source);
      if (!detail) return;
      const done = await writeClipboard(buildPayoutMessage(detail));
      setNotice(
        done
          ? { tone: "success", text: "List copied - paste it into WhatsApp or a message." }
          : { tone: "danger", text: "Could not copy automatically. Use the WhatsApp button instead." },
      );
    },
    [resolve],
  );

  return { whatsApp, copy, prefetch: loader.prefetch, notice };
}

export function ShareNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div role="status" className="mb-3">
      <Alert tone={notice.tone === "success" ? "success" : "danger"}>{notice.text}</Alert>
    </div>
  );
}
