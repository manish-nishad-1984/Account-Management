import { useCallback, useEffect, useState } from "react";
import type { PayoutListDetail } from "@accountmanagement/contracts";
import { Alert } from "../../components/ui";
import { ApiError } from "../../lib/api-client";
import { usePayoutDetailLoader } from "./api";
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

  const whatsApp = useCallback(
    async (source: string | PayoutListDetail) => {
      const detail = await resolve(source);
      if (!detail) return;
      window.open(whatsAppUrl(buildPayoutMessage(detail)), "_blank", "noopener");
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
