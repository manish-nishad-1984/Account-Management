/**
 * Runs the LEGACY money calculators and reports what they actually produce.
 *
 * 07-Business-Rule-Inventory.md finding D-JS-1 says the Create Invoice screen
 * loads three scripts that define the same global function names, so the last
 * one wins and the Invoice formulas are overwritten by the Purchase Order ones.
 * That was read off the source. This RUNS it.
 *
 * The real files from AccountManegments.Web/wwwroot/moduls are loaded into jsdom
 * in the real order (CreateInvoice.cshtml:896-898), against a reproduction of
 * the real markup, and the totals fields are read back.
 *
 * EVIDENCE ABOUT THE CODE, NOT ABOUT PRODUCTION. It cannot know what build the
 * live server serves. Question 2 of 19-Business-Decisions-Required.md still
 * needs someone to try it on the real screen.
 *
 *   node run.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";


const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..", "..", "AccountManegments.Web", "wwwroot");
const MODULS = join(WEB, "moduls");

// jsdom comes from the web app's devDependencies; nothing here needs its own.
const require = createRequire(join(HERE, "..", "..", "..", "node", "apps", "web", "package.json"));
const { JSDOM, VirtualConsole } = require("jsdom");

const read = (path) => readFileSync(path, "utf8");
const HTML = read(join(HERE, "harness.html"));

/**
 * A fresh document with jQuery and the named scripts evaluated in order.
 *
 * Every one of these files touches `document.getElementById(...).addEventListener`
 * or calls a helper defined in another file at load time, so each throws part
 * way through. FUNCTION DECLARATIONS ARE HOISTED, so the definitions still land
 * — which is exactly why the collision happens in the browser too. The throw is
 * recorded rather than hidden.
 */
function page(scripts, screen = "invoice") {
  const virtualConsole = new VirtualConsole(); // the app's own load-time noise
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "http://localhost/", virtualConsole });
  const { window } = dom;
  window.eval(read(join(WEB, "assets", "js", "jquery.min.js")));

  /**
   * One fixture, two pages. The Sales rows carry class="product" exactly as the
   * invoice AJAX rows do (_DisplaySalesItemDetailsPartial.cshtml:5), so leaving
   * both in one document would make $(".product") span both tables — which never
   * happens in the real app, and would poison every sum with NaN.
   */
  const $prune = window.$;
  if (screen === "invoice") $prune("#sales-table").remove();
  else $prune("tr[data-shape=ajax], tr[data-shape=in-page]").remove();

  const notes = [];
  for (const file of scripts) {
    try {
      window.eval(read(join(MODULS, file)));
      notes.push(`${file}`);
    } catch (error) {
      notes.push(`${file}   (threw at load: ${error.message})`);
    }
  }
  return { window, $: window.$, notes };
}

/** CreateInvoice.cshtml:896-898, in that order. */
const CREATE_INVOICE = [
  "InvoiceMasterScript.js",
  "PurchaseRequestScript.js",
  "SalesInvoiceMasterScript.js",
];

const line = (s = "") => console.log(s);
const rule = (c = "-") => line(c.repeat(78));

/** Which file a surviving definition came from, read off its own source. */
const fingerprint = (fn) => {
  if (!fn) return "NOT DEFINED";
  const src = String(fn);
  if (src.includes('$(".productRow")') || src.includes(".txtproductamount")) {
    return "InvoiceMasterScript  (purchase INVOICE)";
  }
  if (src.includes('$(".product")') || src.includes("#txtproductamount")) {
    return "PurchaseRequestScript  (purchase ORDER)";
  }
  return "unknown";
};

const money = (v) => String(v ?? "").padStart(10);

// ── 1. what wins ────────────────────────────────────────────────────────────
line();
rule("=");
line("WHAT THE LEGACY CALCULATORS ACTUALLY DO");
rule("=");

const invoice = page(CREATE_INVOICE);
line("Scripts, in the order CreateInvoice.cshtml loads them:");
for (const n of invoice.notes) line("  " + n);
line();
line("Which definition survives:");
for (const name of ["updateProductTotalAmount", "updateTotals"]) {
  line(`  ${name.padEnd(26)} ${fingerprint(invoice.window[name])}`);
}

// ── 2. the table it cannot see ──────────────────────────────────────────────
line();
rule();
line("THE TABLE, AND WHAT THE SURVIVING CALCULATOR MAKES OF IT");
rule();
line("  row rendered WITH THE PAGE (class=productRow):  10 x 100.00 @ 18%  = 1180.00");
line("  row added BY AJAX          (class=product)   :   4 x 125.00 @ 18%  =  590.00");
line("  correct: subtotal 1500.00   GST 270.00   grand total 1770.00");
line();

const clickEveryRow = ({ window, $ }) => {
  $("tr.productRow, tr.product").each(function () {
    if ($(this).attr("data-shape") === "sales") return;
    window.updateProductTotalAmount(this);
  });
};

clickEveryRow(invoice);
line("After clicking each row (the markup's own onclick):");
line(`  in-page row   gst ${money(invoice.$("#txtgstAmount_1").val())}   total ${money(invoice.$("#txtproducttotalamount_1").val())}`);
line(`  ajax    row   gst ${money(invoice.$("#txtgstAmount").val())}   total ${money(invoice.$("#txtproducttotalamount").val())}`);
line();
line("  The in-page row does not move. The surviving updateProductTotalAmount");
line("  reads #txtproductamount; that row's input is id=txtproductamount_1.");

invoice.window.updateTotals();
line();
line("updateTotals wrote:");
for (const id of ["cart-subtotal", "totalgst", "cart-discount", "cart-total"]) {
  line(`  #${id.padEnd(22)} ${money(invoice.$("#" + id).val())}`);
}
line();
line(`  Of the correct subtotal 1500.00 it counted ${invoice.$("#cart-subtotal").val()} — the AJAX row`);
line("  alone (4 x 125.00). The page-rendered row is invisible to $(\".product\"),");
line("  so PART OF THE INVOICE IS MISSING FROM ITS OWN TOTAL.");

// ── 3. TDS ──────────────────────────────────────────────────────────────────
line();
rule();
line("DOES TDS CHANGE THE TOTAL?    (question 2 of doc 19)");
rule();
const before = invoice.$("#cart-total").val();
invoice.$("#cart-tds").val("500");
invoice.$("#IDiscountRoundOff").val("7");
invoice.window.updateTotals();
const after = invoice.$("#cart-total").val();
line(`  TDS 0,   round-off 0  ->  ${money(before)}`);
line(`  TDS 500, round-off 7  ->  ${money(after)}`);
line(`  => ${before === after ? "IGNORED. Both fields are never read." : "APPLIED."}`);

// ── 4. the calculator that was overwritten ──────────────────────────────────
line();
rule();
line("THE SAME TABLE, THROUGH THE INVOICE CALCULATOR THAT LOST");
rule();
const onlyInvoice = page(["InvoiceMasterScript.js"]);
clickEveryRow(onlyInvoice);
onlyInvoice.window.updateTotals();
line(`  #cart-subtotal        ${money(onlyInvoice.$("#cart-subtotal").val())}`);
line(`  #totalgst             ${money(onlyInvoice.$("#totalgst").val())}`);
line(`  #cart-total           ${money(onlyInvoice.$("#cart-total").val())}`);
const invoiceBefore = onlyInvoice.$("#cart-total").val();
onlyInvoice.$("#cart-tds").val("500");
onlyInvoice.$("#IDiscountRoundOff").val("7");
onlyInvoice.window.updateTotals();
line(`  with TDS 500 + 7      ${money(onlyInvoice.$("#cart-total").val())}`);
line(`  => TDS ${invoiceBefore === onlyInvoice.$("#cart-total").val() ? "IGNORED" : "APPLIED"}`);
line();
line("  1180.00 = the IN-PAGE row only (10 x 100.00). It reads by class, which");
line("  only the page-rendered rows carry. Neither answer is 1770.00: the two");
line("  calculators cover DISJOINT halves of one table, so NO load order totals");
line("  the whole invoice.");

// ── 5. the whole-rupee round-off ────────────────────────────────────────────
line();
rule();
line("THE WHOLE-RUPEE ROUND-OFF, WHICH NO DOCUMENT RECORDS");
rule();
line("  InvoiceMasterScript.js:1005 and SalesInvoiceMasterScript.js:381:");
line("    decimal = total - floor(total);  total = decimal <= 0.50 ? floor : ceil");
line();
line("  An invoice total is therefore ALWAYS a whole rupee, and exactly .50");
line("  rounds DOWN — half a paisa in the customer's favour, every time.");
line();
line("     line             exact      charged    difference");
for (const [qty, price, gst] of [
  ["1", "100.40", "0"],
  ["1", "100.50", "0"],
  ["1", "100.51", "0"],
  ["3", "33.51", "18"],
  ["7", "1249.99", "18"],
]) {
  const p = page(["InvoiceMasterScript.js"]);
  p.$("#txtproductquantity_1").val(qty);
  p.$("#txtproductamount_1").val(price);
  p.$("#txtgst_1").val(gst);
  // Empty the AJAX row so only the in-page row counts for this calculator.
  p.$("#txtproductquantity").val("0");
  p.$("#txtproductamount").val("0");
  p.$("#txtgst").val("0");
  clickEveryRow(p);
  p.window.updateTotals();
  const exact = Number(qty) * Number(price) * (1 + Number(gst) / 100);
  const charged = Number(p.$("#cart-total").val());
  line(
    `  ${(qty + " x " + price + " @ " + gst + "%").padEnd(18)}` +
      `${exact.toFixed(2).padStart(10)}${charged.toFixed(2).padStart(12)}` +
      `${(charged - exact).toFixed(2).padStart(12)}`,
  );
}

// ── 6. sales ────────────────────────────────────────────────────────────────
line();
rule();
line("SALES: the discount that is shown but never subtracted");
rule();
const sales = page(["SalesInvoiceMasterScript.js"], "sales");
sales.$("#sales-table").removeAttr("hidden");

const runSales = () => {
  sales.window.updateSalesProductTotalAmount(sales.$("tr[data-shape=sales]")[0]);
  sales.window.updateSalesTotals();
};
runSales();
line(`  no discount   subtotal ${money(sales.$("#Sales-cart-subtotal").val())}   ` +
     `gst ${money(sales.$("#Salestotalgst").val())}   total ${money(sales.$("#Sales-cart-total").val())}`);
sales.$("#txtSalesdiscountamount").val("10");
runSales();
line(`  10 per unit   subtotal ${money(sales.$("#Sales-cart-subtotal").val())}   ` +
     `gst ${money(sales.$("#Salestotalgst").val())}   total ${money(sales.$("#Sales-cart-total").val())}`);
line(`                discount shown: ${money(sales.$("#Sales-cart-discount").val())}`);
line();
line("  The GST fell (it is charged on price minus discount) but the SUBTOTAL did");
line("  not, because updateSalesTotals sums the VISIBLE price while the per-line");
line("  GST used the HIDDEN price minus the discount. And the roll-up is");
line("     totalAmount = subtotal + gst - Tds + roundOff");
line("  with no discount term at all: the ₹100 of discount is displayed and never");
line("  taken off. It comes off only if something else already overwrote the");
line("  visible price — which is a different code path, on a different event.");

line();
rule("=");
line("Read with 19-Business-Decisions-Required.md questions 1 and 2.");
rule("=");
line();
