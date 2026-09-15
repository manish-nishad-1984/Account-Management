import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  printTitle,
  type DocumentType,
  type PrintCompany,
  type PrintDocument,
  type PrintLine,
  type PrintParty,
} from "@accountmanagement/contracts";
import { amountInWords, money, summariseTax } from "@accountmanagement/domain";
import { DATABASE, type Database } from "../../db/database";
import { cities, companies, items, siteGroups, sites, states, suppliers } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";
import { SalesInvoicesRepository } from "../sales-invoices/sales-invoices.repository";
import { PurchaseInvoicesRepository } from "../purchase-invoices/purchase-invoices.repository";

/** "Ground Floor, Ring Road, Surat, Gujarat 395002" — the parts that exist. */
const joinAddress = (...parts: Array<string | null | undefined>): string | null => {
  const present = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(", ") : null;
};

/**
 * Everything an invoice prints with, gathered into one shape both invoice types
 * share, so a template does not care which one it is drawing.
 *
 * READ-ONLY, AND THROUGH THE INVOICE MODULES' OWN READS. The invoice itself comes
 * from `SalesInvoicesRepository.findById` and `PurchaseInvoicesRepository.findById`
 * — the same calls the invoice screens make — so printing can never show a
 * different invoice from the one on screen, and nothing in those modules had to
 * change for it.
 *
 * What the invoice read does not carry — the company's and the party's address
 * and state, the site's name, each item's HSN code — is read here.
 */
@Injectable()
export class PrintDocumentsRepository extends BaseRepository {
  constructor(
    @Inject(DATABASE) database: Database | null,
    private readonly salesInvoices: SalesInvoicesRepository,
    private readonly purchaseInvoices: PurchaseInvoicesRepository,
  ) {
    super(database);
  }

  async salesInvoice(id: string): Promise<PrintDocument> {
    const invoice = await this.salesInvoices.findById(id);
    const [company, party, site, hsn] = await Promise.all([
      this.company(invoice.companyId),
      this.party(invoice.customerId),
      this.siteName(invoice.siteId),
      this.hsnCodes(invoice.items.map((line) => line.itemId)),
    ]);

    return this.assemble("sales-invoice", {
      id: invoice.id,
      companyId: invoice.companyId,
      invoiceType: invoice.invoiceType,
      number: invoice.salesInvoiceNo,
      date: invoice.documentDate,
      fields: {
        partyInvoiceNo: invoice.customerInvoiceNo,
        purchaseOrderNo: null,
        challanNo: invoice.challanNo,
        lrNo: invoice.lrNo,
        vehicleNo: invoice.vehicleNo,
        dispatchBy: invoice.dispatchBy,
        paymentTerms: invoice.paymentTerms,
        siteName: site,
        siteGroupName: null,
        contactName: invoice.contactName,
        contactNumber: invoice.contactNumber,
      },
      description: invoice.description,
      shippingAddress: invoice.shippingAddress,
      company,
      party,
      items: invoice.items,
      hsn,
      charges: invoice,
    });
  }

  async purchaseInvoice(id: string): Promise<PrintDocument> {
    const invoice = await this.purchaseInvoices.findById(id);
    const [company, party, site, group, hsn] = await Promise.all([
      this.company(invoice.companyId),
      this.party(invoice.supplierId),
      this.siteName(invoice.siteId),
      this.siteGroupName(invoice.siteGroupId),
      this.hsnCodes(invoice.items.map((line) => line.itemId)),
    ]);

    return this.assemble("purchase-invoice", {
      id: invoice.id,
      companyId: invoice.companyId,
      invoiceType: invoice.invoiceType,
      number: invoice.displayNo,
      date: invoice.documentDate,
      fields: {
        partyInvoiceNo: invoice.supplierInvoiceNo,
        purchaseOrderNo: invoice.purchaseOrderNo,
        challanNo: invoice.challanNo,
        lrNo: invoice.lrNo,
        vehicleNo: invoice.vehicleNo,
        dispatchBy: invoice.dispatchBy,
        paymentTerms: invoice.paymentTerms,
        siteName: site,
        siteGroupName: group,
        contactName: invoice.contactName,
        contactNumber: invoice.contactNumber,
      },
      description: invoice.description,
      shippingAddress: invoice.shippingAddress ?? invoice.groupAddress,
      company,
      party,
      items: invoice.items,
      hsn,
      charges: invoice,
    });
  }

  private assemble(
    documentType: DocumentType,
    source: {
      id: string;
      companyId: string;
      invoiceType: string;
      number: string;
      date: string | null;
      fields: PrintDocument["fields"];
      description: string | null;
      shippingAddress: string | null;
      company: PrintCompany;
      party: PrintParty;
      items: Array<Omit<PrintLine, "name" | "description" | "hsnCode"> & {
        itemId: string | null;
        itemLabel: string;
        itemDescription: string | null;
      }>;
      hsn: Map<string, string>;
      charges: {
        subtotal: string;
        totalDiscount: string;
        totalGstAmount: string;
        tds: string;
        roundOff: string;
        totalAmount: string;
      };
    },
  ): PrintDocument {
    const lines: PrintLine[] = [...source.items]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        lineNumber: line.lineNumber,
        name: line.itemLabel,
        description: line.itemDescription,
        hsnCode: line.itemId ? (source.hsn.get(line.itemId) ?? null) : null,
        quantity: line.quantity,
        unitName: line.unitName,
        unitPrice: line.unitPrice,
        discountPerUnit: line.discountPerUnit,
        discountPercent: line.discountPercent,
        gstPercent: line.gstPercent,
        gstAmount: line.gstAmount,
        netAmount: line.netAmount,
        lineTotal: line.lineTotal,
      }));

    const taxSummary = summariseTax(lines);
    const { charges } = source;

    return {
      documentType,
      id: source.id,
      companyId: source.companyId,
      invoiceType: source.invoiceType,
      title: printTitle(documentType, source.invoiceType),
      number: source.number,
      date: source.date,
      fields: source.fields,
      description: source.description,
      shippingAddress: source.shippingAddress,
      company: source.company,
      party: source.party,
      lines,
      totals: {
        totalQuantity: money.format(money.sum(lines.map((line) => money.decimal(line.quantity))), 3).replace(/\.?0+$/, ""),
        subtotal: charges.subtotal,
        totalDiscount: charges.totalDiscount,
        totalGstAmount: charges.totalGstAmount,
        tds: charges.tds,
        roundOff: charges.roundOff,
        totalAmount: charges.totalAmount,
      },
      taxSummary,
      amountInWords: amountInWords(charges.totalAmount),
      taxInWords: amountInWords(charges.totalGstAmount),
    };
  }

  private async company(id: string): Promise<PrintCompany> {
    const [row] = await this.db
      .select({
        name: companies.name,
        address: companies.address,
        area: companies.area,
        pincode: companies.pincode,
        gstNo: companies.gstNo,
        panNo: companies.panNo,
        bankName: companies.bankName,
        bankBranch: companies.bankBranch,
        accountNo: companies.accountNo,
        ifscCode: companies.ifscCode,
        cityName: cities.name,
        stateName: states.name,
        stateCode: states.stateCode,
      })
      .from(companies)
      .leftJoin(cities, eq(cities.id, companies.cityId))
      .leftJoin(states, eq(states.id, companies.stateId))
      .where(eq(companies.id, id))
      .limit(1);

    if (!row) throw new NotFoundException("The invoice's company was not found");
    return {
      name: row.name,
      address: joinAddress(row.address, row.area, row.cityName, row.pincode),
      gstNo: row.gstNo,
      panNo: row.panNo,
      stateName: row.stateName,
      stateCode: row.stateCode === null ? null : String(row.stateCode).padStart(2, "0"),
      bankName: row.bankName,
      bankBranch: row.bankBranch,
      accountNo: row.accountNo,
      ifscCode: row.ifscCode,
    };
  }

  /** The supplier or customer — one party table serves both. No bank details. */
  private async party(id: string): Promise<PrintParty> {
    const partyState = alias(states, "party_state");
    const [row] = await this.db
      .select({
        name: suppliers.name,
        buildingName: suppliers.buildingName,
        area: suppliers.area,
        pincode: suppliers.pincode,
        gstNo: suppliers.gstNo,
        mobile: suppliers.mobile,
        email: suppliers.email,
        cityName: cities.name,
        stateName: partyState.name,
        stateCode: partyState.stateCode,
      })
      .from(suppliers)
      .leftJoin(cities, eq(cities.id, suppliers.cityId))
      .leftJoin(partyState, eq(partyState.id, suppliers.stateId))
      .where(eq(suppliers.id, id))
      .limit(1);

    if (!row) throw new NotFoundException("The invoice's party was not found");
    return {
      name: row.name,
      address: joinAddress(row.buildingName, row.area, row.cityName, row.pincode),
      gstNo: row.gstNo,
      stateName: row.stateName,
      stateCode: row.stateCode === null ? null : String(row.stateCode).padStart(2, "0"),
      mobile: row.mobile,
      email: row.email,
    };
  }

  private async siteName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [row] = await this.db.select({ name: sites.name }).from(sites).where(eq(sites.id, id)).limit(1);
    return row?.name ?? null;
  }

  private async siteGroupName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [row] = await this.db
      .select({ name: siteGroups.name })
      .from(siteGroups)
      .where(eq(siteGroups.id, id))
      .limit(1);
    return row?.name ?? null;
  }

  private async hsnCodes(itemIds: Array<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set(itemIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: items.id, hsnCode: items.hsnCode })
      .from(items)
      .where(and(inArray(items.id, ids)));
    return new Map(rows.filter((row) => row.hsnCode).map((row) => [row.id, row.hsnCode!]));
  }
}
