import { z } from "zod";

/**
 * The terms and conditions on a purchase order, and the three templates behind
 * them.
 *
 * WHAT THE SOURCE ACTUALLY DOES, which is not what the screen capture suggested
 *
 * `08-create-purchase-order.md` describes "three tabbed templates over a rich
 * text editor" and reads them as three STORED templates. They are not stored
 * anywhere. `Views/PurchaseMaster/CreatePurchaseOrder.cshtml:704-855` hard-codes
 * all three as literal boilerplate inside the Razor view, one per tab pane, each
 * mounted as a CKEditor instance. Nothing in the database holds a template and
 * no screen edits one — changing a template means changing the view and
 * redeploying.
 *
 * So they are constants here, exactly as they are constants there. Making them
 * editable is a new capability the business has to ask for, not a gap in the
 * port; a `terms_templates` table would have looked faithful and would have
 * invented a screen that has never existed.
 *
 * TWO COLUMNS, AND THE ONE THAT IS EASY TO GET WRONG
 *
 * The source posts the editor's HTML as `PaymentTerms` and the chosen tab as
 * `PaymentTermsId` — the literal strings "Term-1", "Term-2", "Term-3", in an
 * `nvarchar(100)`. It does NOT write the `Terms` column: no control on the
 * create screen binds to it.
 *
 * That matters for the ETL, because the port's column names read the other way
 * round. The legacy `PaymentTerms` is this document's terms and conditions and
 * loads into `purchase_orders.terms`. The port's `payment_terms` is a short free
 * text field of its own and legacy data must NOT be loaded into it — doing so
 * would drop a page of terms into a one-line box and leave `terms` empty. The
 * note is repeated on the schema column, because that is where an ETL author
 * looks.
 *
 * Only the ACTIVE tab is read on save (`PurchaseRequestScript.js:1013-1025`), so
 * edits made in the other two tabs are discarded without a word. Reproduced:
 * there is one editor here and one set of terms, which is the same outcome
 * without the trap of typing into a box whose contents are thrown away.
 */

export const TERMS_TEMPLATE_KEYS = ["template-1", "template-2", "template-3"] as const;
export type TermsTemplateKey = (typeof TERMS_TEMPLATE_KEYS)[number];

/**
 * `PaymentTermsId` holds "Term-1" in SQL Server. The ETL maps it with this,
 * rather than storing the legacy string and leaving every reader to decode it.
 * An unrecognised value maps to null — the order keeps its terms and simply has
 * no template recorded, which is what an unknown tab means.
 */
export const LEGACY_TERMS_TEMPLATE_IDS: Readonly<Record<string, TermsTemplateKey>> = {
  "Term-1": "template-1",
  "Term-2": "template-2",
  "Term-3": "template-3",
};

export interface TermsTemplate {
  key: TermsTemplateKey;
  /** The tab label, as the legacy screen shows it. */
  label: string;
  /** Sanitised HTML — the same subset the stored column accepts. */
  html: string;
}

/**
 * The three templates, transcribed from the Razor view.
 *
 * Verbatim, including the misspellings ("Premies", "possiblity", "ap.proval",
 * "reching") and the company names. Two of the three name a specific company and
 * a specific GST number, which is boilerplate that belongs in a master rather
 * than in source code — but it belongs there in the source too, and correcting
 * the text here would change what is printed on an order without anybody asking
 * for it. Doc 19 is where that gets raised, not a commit.
 */
export const TERMS_TEMPLATES: readonly TermsTemplate[] = [
  {
    key: "template-1",
    label: "Template 1",
    html: [
      "<p>Terms &amp; Condition</p>",
      "<p>1. Prices: The Above Price are on site Vadodara</p>",
      "<p>2. Packing: Pvc Wrapping</p>",
      "<p>3. Include Freight &amp; Annexure of 28 &amp; 29 Nos. Meter Panel</p>",
      "<p>4. Tax: 18% GST Extra</p>",
      "<p>5. Delivery: 15 to 20 Days From the Date of Purchase Order</p>",
      "<p>6. Payment: 10% advance along with PO, Balance Payment 15 Days After Material Dispatch</p>",
      "<p>7. Validity of Offer: 20 Days</p>",
      "<p>8. Warranty: 12 Months Against Manufacturing Defect &amp; Switchgear from the date of delivery.</p>",
    ].join(""),
  },
  {
    key: "template-2",
    label: "Template 2",
    html: [
      "<p>Terms &amp; Condition</p>",
      "<p>1. The Supplier will Accept Site Wieght &amp; Measurement as correct &amp; Final</p>",
      "<p>2. All Goods are Subjects to Final approval at site Premies.</p>",
      "<p>3. The Tax Invoice are to be raised in name of DH PATEL, GST No. 24AABFD8160H1ZN</p>",
      "<p>4. Purchase Order no is must on each Invoice.</p>",
      "<p>5. In Case of deviation from above mentioned supply, the supplier must contact the concern Person for ap.proval</p>",
      "<p>6. All necessary test Certificates to be sent alongwith the material. Material will be tested at our end,</p>",
      "<p>7. In case of rejection of Material, Supplier will take the material back &amp;testing Charges will be paid by Supplier.</p>",
    ].join(""),
  },
  {
    key: "template-3",
    label: "Template 3",
    html: [
      "<p>Terms &amp; Condition</p>",
      "<p>1. Party shall be responsible for strength only.</p>",
      "<p>2. Cube casting &amp; testing are conducted in our in-plant laboratory.</p>",
      "<p>3. Addition &amp; Deletion of water at site rights reserve with us.</p>",
      "<p>4. Harikrishna is no way responsible for any plastic shrinkage or settlement cracks as these occur primarily due to improper handling of concrete during and post settlement.</p>",
      "<p>5. In no event shall Harikrishna Concrete Solutions be liable for direct, indirect, special, incidental or consequential damages arising out of the use of this product, even if advised of the possiblity of such.</p>",
      "<p>6. Damages. In no case shall Harikrishna Concrete Solution's liability exceed the purchase price of this product.</p>",
      "<p>7. Vehicles should not be detained for more than 1 hour after reching the site. For retention more than 1 hr, RS.400/- per Hr.retention charges will be to your account for each hour delay.</p>",
    ].join(""),
  },
];

export const termsTemplateKey = z.enum(TERMS_TEMPLATE_KEYS);

/**
 * THE HTML SUBSET THE TERMS COLUMN ACCEPTS.
 *
 * The source renders stored terms with `@Html.Raw(firstItem.PaymentTerms)`
 * (`POPrintDetails.cshtml:406`) — unescaped, straight into the printed order. So
 * whatever HTML is stored executes for everyone who opens that order. That is
 * stored XSS on the application's own origin, and it is the reason this port
 * refused to store HTML at all until a sanitiser existed. This is that
 * sanitiser's allowlist.
 *
 * It lives in `contracts` as DATA, not as code: the API applies it with
 * `sanitize-html` on the way in, and the editor offers exactly these tags and
 * nothing else, so the browser cannot produce markup the server will silently
 * strip. A user watching formatting disappear on save has no way to tell a
 * security control from a bug.
 *
 * WHAT IS DELIBERATELY NOT ON IT, though the legacy toolbar offers it:
 *
 * - `img`. An external image on a purchase order is a tracking pixel that fires
 *   for every reader, and it prints as a broken box the day the host goes away.
 *   An inline data URI is a second way to smuggle bytes past the attachment
 *   allowlist of §5l.
 * - `iframe` / `embed` / `object`. The legacy "embed" button. Framing arbitrary
 *   third-party content inside a document of record is not a formatting choice.
 * - `style` and `class` on anything. `style` alone carries most of what is left
 *   of CSS-based attacks, and neither survives a print stylesheet usefully.
 * - `script`, `on*` handlers, `javascript:` URLs — the actual hole.
 *
 * `table` IS on it: the legacy toolbar has one and a rate table inside terms is
 * a plausible thing to have typed over several years. Removing tables from
 * imported terms would silently reshape existing documents.
 */
export const TERMS_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
] as const;

/** Every other attribute is dropped, on every tag. */
export const TERMS_ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href", "title"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
};

/** Anything else in an `href` — `javascript:` above all — loses the attribute. */
export const TERMS_ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

/**
 * `b` and `i` are accepted from the legacy data and stored as `strong` and `em`,
 * so the column holds one spelling of each idea. Both browsers and print
 * stylesheets treat them identically; what differs is that two spellings make
 * every later consumer handle both.
 */
export const TERMS_TAG_REPLACEMENTS: Readonly<Record<string, string>> = {
  b: "strong",
  i: "em",
  div: "p",
};

/**
 * The cap on stored terms.
 *
 * Template 3 is the longest of the three at well under 2 kB of HTML. 20 000
 * characters is roughly ten times the longest thing anybody has typed, and it is
 * a bound on what one order can put into a list response rather than a
 * judgement about content.
 */
export const TERMS_MAX_LENGTH = 20_000;
