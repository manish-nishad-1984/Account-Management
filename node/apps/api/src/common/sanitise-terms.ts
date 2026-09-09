import sanitizeHtml from "sanitize-html";
import {
  TERMS_ALLOWED_ATTRIBUTES,
  TERMS_ALLOWED_SCHEMES,
  TERMS_ALLOWED_TAGS,
  TERMS_TAG_REPLACEMENTS,
} from "@accountmanagement/contracts";

/**
 * The only thing that writes `purchase_orders.terms`.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The legacy purchase order print view renders stored terms with
 * `@Html.Raw(firstItem.PaymentTerms)` (`POPrintDetails.cshtml:406`) — no
 * escaping, straight into the page. Whatever HTML sits in that column runs for
 * everyone who opens the order, with their session attached. It is the same
 * class of hole §5l closed on attachments, and it is why this port stored terms
 * as plain text until a sanitiser existed rather than shipping the editor first
 * and the sanitiser afterwards.
 *
 * WHY IT IS ON THE SERVER AND NOT IN THE ZOD SCHEMA
 *
 * `contracts` runs in the browser too. A transform there would be applied by the
 * form and skipped entirely by anything posting to the API directly, which is
 * the case that matters. The contract checks the LENGTH, which is a property of
 * the string; the server checks the MARKUP, which is a security boundary.
 *
 * WHY IT IS NOT HAND-WRITTEN
 *
 * Parsing hostile HTML correctly is a specialist job with a long history of
 * near-misses — mXSS through mutated parse trees, namespace confusion in
 * `<svg>` and `<math>`, attribute smuggling through malformed entities. A
 * regular expression over tags is the classic wrong answer. `sanitize-html`
 * parses with `htmlparser2` and rebuilds the document from an allowlist, which
 * is the shape that is defensible.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...TERMS_ALLOWED_TAGS],
  allowedAttributes: Object.fromEntries(
    Object.entries(TERMS_ALLOWED_ATTRIBUTES).map(([tag, attributes]) => [tag, [...attributes]]),
  ),
  allowedSchemes: [...TERMS_ALLOWED_SCHEMES],
  transformTags: Object.fromEntries(
    Object.entries(TERMS_TAG_REPLACEMENTS).map(([from, to]) => [from, to]),
  ),

  /**
   * Text inside a disallowed tag is DROPPED, not kept.
   *
   * The default keeps it, so `<script>alert(1)</script>` becomes the visible
   * text `alert(1)` sitting in the middle of a purchase order's terms. That is
   * not a security problem — it cannot execute — but it is a correctness one:
   * the terms of a document of record would silently gain a line nobody typed.
   * Dropping the content of a script or a style block is what a reader expects
   * to have happened.
   */
  nonTextTags: ["script", "style", "textarea", "noscript"],

  /**
   * No `target="_blank"`, and therefore no `rel` to repair. A purchase order's
   * terms are printed as often as they are read on screen, and a link that
   * opens a new tab prints identically to one that does not.
   */
  allowedSchemesAppliedToAttributes: ["href"],

  /**
   * `//example.com` is refused along with the rest.
   *
   * A protocol-relative link inherits the scheme of the page it is on, and the
   * page these terms are most often on is a printed sheet of paper, where it
   * inherits nothing and means nothing. The library allows them by default;
   * there is no case for one inside a purchase order's terms.
   */
  allowProtocolRelative: false,

  disallowedTagsMode: "discard",
};

/**
 * Reduce submitted terms to the allowlist.
 *
 * Returns null for anything that has no content left — an empty string, markup
 * that was entirely disallowed, or a document of empty paragraphs, which is what
 * `contenteditable` leaves behind when a person selects everything and deletes
 * it. Storing `<p><br></p>` would make "no terms" print as a blank line and read
 * back as a non-null value, so the two states would stop being distinguishable.
 */
export function sanitiseTerms(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;

  const clean = sanitizeHtml(html, OPTIONS).trim();
  return hasVisibleContent(clean) ? clean : null;
}

/**
 * Whether anything would be seen if this were rendered.
 *
 * Tags are removed and entities are collapsed before looking, so
 * `<p>&nbsp;</p>` and `<ul><li></li></ul>` both count as empty. `&nbsp;` is the
 * one that matters in practice: every `contenteditable` implementation inserts
 * it while typing and leaves it behind on delete.
 */
function hasVisibleContent(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .trim();

  return text.length > 0;
}
