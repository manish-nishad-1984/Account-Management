/**
 * Hands a fetched file to the browser as a download.
 *
 * Every download in this app is a `fetch` followed by this, never an anchor
 * pointing at the API. The access token lives in memory and never in a cookie,
 * so a browser-initiated navigation carries no credentials and the server
 * answers 401 — which looks like a broken button rather than an auth problem.
 *
 * Extracted when the report exports were built and there were nine of these
 * rather than one. The revoke is the part worth centralising: without it every
 * download leaks its blob for the life of the page, and a person exporting a
 * ledger repeatedly is exactly who notices.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
