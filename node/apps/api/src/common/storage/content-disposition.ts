/** Control characters, which must never reach a header value. */
const CONTROL = new RegExp("[\u0000-\u001f\u007f]", "g");

/** Anything outside printable ASCII, for the plain `filename` parameter. */
const NON_ASCII = /[^ -~]/g;

/**
 * A `Content-Disposition` header for a download, safe for any file name.
 *
 * The header is a structured field and a file name is arbitrary user text, so
 * interpolating one into the other is header injection waiting to happen: a name
 * containing a quote ends the parameter early, and one containing CR or LF ends
 * the HEADER — which is response splitting, and lets an uploaded file name write
 * headers of its own. Both are removed rather than escaped.
 *
 * Two forms are sent, as RFC 6266 recommends:
 *
 *   filename="..."      ASCII only, for anything that predates RFC 5987
 *   filename*=UTF-8''…  percent-encoded, and what every current browser uses
 *
 * So a Gujarati or Hindi file name downloads under its own name, and a client
 * that cannot read the second parameter still gets a sensible one.
 *
 * Always `attachment`. Never `inline`: rendering an uploaded file in a tab is
 * what makes an uploaded `.svg` or `.html` a stored XSS on this origin, and the
 * allowlist is there so that a mistake here is not also a compromise — not so
 * that this can be relaxed.
 */
export function contentDisposition(fileName: string, fallback = "attachment"): string {
  const clean = fileName.replace(CONTROL, "").replace(/[\\"]/g, "").trim();

  const name = clean === "" || clean === "." || clean === ".." ? fallback : clean;
  // `;` and `,` separate parameters. Inside a quoted string they are legal per
  // RFC 6266, and a strict parser handles them — but a lenient one splits on
  // them anyway, and the real name is already carried, exactly, by the encoded
  // parameter. So the plain one gives them up rather than relying on every
  // client being strict.
  const ascii = name.replace(NON_ASCII, "_").replace(/[;,]/g, "_") || fallback;

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
