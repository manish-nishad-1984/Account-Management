import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueuedAttachments } from "./ChallanAttachments";
import { renderWithAuth } from "../../test/render";

/**
 * "TAKE PHOTO" ON THE ATTACHMENTS PANEL (client request, 29 Sep 2026).
 *
 * A challan is very often keyed standing at the gate with the paper right
 * there, and this opens a camera in place rather than sending someone to the
 * phone's own camera app and back. The captured frame is a real File — JPEG,
 * from `canvas.toBlob` — that goes through the SAME picker path as a chosen
 * file, so it is worth pinning that it is not a second, untested way in.
 */

function Harness() {
  const [files, setFiles] = useState<File[]>([]);
  return <QueuedAttachments files={files} onChange={setFiles} />;
}

/** A stand-in `MediaStream`: only `getTracks` is ever called on it here. */
function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

describe("the camera on the attachments panel", () => {
  beforeEach(() => {
    // jsdom implements neither; both are asserted on directly rather than left
    // to throw, so a real assertion failure reads as one instead of a jsdom
    // "not implemented" error.
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("says the camera is unavailable when the browser has none, and offers no dead Capture button", async () => {
    // The real jsdom default: no `navigator.mediaDevices` at all.
    renderWithAuth(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: /take photo/i }));

    expect(
      await screen.findByText(/this browser cannot open the camera\. choose a file instead/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^capture$/i })).not.toBeInTheDocument();
  });

  it("captures a frame, and hands it to the picker as a real JPEG File", async () => {
    const { stream, track } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    // jsdom draws nothing, so the capture pipeline is stubbed at its two real
    // boundaries: the frame has SOME size, and toBlob produces something.
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 480 });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb!(new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" })),
    );
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });

    renderWithAuth(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /take photo/i }));

    // Requests the REAR camera, where the paper being photographed is.
    await waitFor(() =>
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      }),
    );

    // The camera has "loaded" once metadata fires — jsdom never fires it on its
    // own, so the moment the stream is attached is fired here explicitly.
    await act(async () => {
      screen.getByRole("dialog").querySelector("video")!.dispatchEvent(new Event("loadedmetadata"));
    });

    await userEvent.click(await screen.findByRole("button", { name: /^capture$/i }));
    expect(drawImage).toHaveBeenCalled();

    await screen.findByAltText(/captured photo/i);
    expect(screen.queryByRole("button", { name: /^capture$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /use this photo/i }));

    // The dialog is gone, and the capture is the picker's own file, named and
    // typed the way anything chosen from disk would be.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const attached = await screen.findByText(/^photo-\d+\.jpg$/);
    expect(attached).toBeInTheDocument();

    // Closing (via a successful capture) must have released the camera.
    expect(track.stop).toHaveBeenCalled();
  });

  it("Retake discards the frame and returns to a live Capture button", async () => {
    const { stream } = fakeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 480 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
      cb!(new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" })),
    );
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });

    renderWithAuth(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /take photo/i }));
    await act(async () => {
      screen.getByRole("dialog").querySelector("video")!.dispatchEvent(new Event("loadedmetadata"));
    });
    await userEvent.click(await screen.findByRole("button", { name: /^capture$/i }));
    await screen.findByAltText(/captured photo/i);

    await userEvent.click(screen.getByRole("button", { name: /retake/i }));

    expect(screen.queryByAltText(/captured photo/i)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^capture$/i })).toBeInTheDocument();
  });

  it("releases the camera when Cancel is pressed with nothing captured", async () => {
    const { stream, track } = fakeStream();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    renderWithAuth(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /take photo/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(track.stop).toHaveBeenCalled();
    // Nothing was added to the queue — Cancel is not a capture.
    expect(screen.queryByText(/^photo-\d+\.jpg$/)).not.toBeInTheDocument();
  });
});
