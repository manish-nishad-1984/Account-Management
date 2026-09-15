import { amountInWords, summariseTax } from "@accountmanagement/domain";
import { printTitle, type DocumentType, type PrintDocument, type PrintLine } from "@accountmanagement/contracts";

/**
 * A made-up invoice to draw thumbnails and previews with, before a real one is
 * chosen. Obviously sample data — "Sample Buyer Pvt Ltd" — so a screenshot of a
 * preview is never mistaken for a real document.
 */

const LINES: PrintLine[] = [
  {
    lineNumber: 1,
    name: "OPC 53 Grade Cement",
    description: "50 kg bag",
    hsnCode: "2523",
    quantity: "100.00",
    unitName: "Bag",
    unitPrice: "380.00",
    discountPerUnit: "10.00",
    discountPercent: "2.63",
    gstPercent: "28.00",
    gstAmount: "10360.00",
    netAmount: "37000.00",
    lineTotal: "47360.00",
  },
  {
    lineNumber: 2,
    name: "TMT Bar Fe 500D 12mm",
    description: null,
    hsnCode: "7214",
    quantity: "2.50",
    unitName: "Tonne",
    unitPrice: "56000.00",
    discountPerUnit: "0.00",
    discountPercent: "0.00",
    gstPercent: "18.00",
    gstAmount: "25200.00",
    netAmount: "140000.00",
    lineTotal: "165200.00",
  },
  {
    lineNumber: 3,
    name: "River Sand",
    description: null,
    hsnCode: "2505",
    quantity: "12.00",
    unitName: "Brass",
    unitPrice: "4500.00",
    discountPerUnit: "0.00",
    discountPercent: "0.00",
    gstPercent: "5.00",
    gstAmount: "2700.00",
    netAmount: "54000.00",
    lineTotal: "56700.00",
  },
];

export function sampleDocument(documentType: DocumentType): PrintDocument {
  const sales = documentType === "sales-invoice";
  return {
    documentType,
    id: "sample",
    companyId: "sample",
    invoiceType: sales ? "Sales" : "Purchase",
    title: printTitle(documentType, sales ? "Sales" : "Purchase"),
    number: sales ? "DHP/26-27/0042" : "PI-0042",
    date: "2026-09-14T00:00:00.000Z",
    fields: {
      partyInvoiceNo: sales ? null : "GT-1022",
      purchaseOrderNo: sales ? null : "PO-0107",
      challanNo: "CH-318",
      lrNo: "LR-7781",
      vehicleNo: "GJ05 AB 1234",
      dispatchBy: "Road",
      paymentTerms: "30 days",
      siteName: "Sample Site",
      siteLocationName: null,
      contactName: "Site Office",
      contactNumber: "98250 00000",
    },
    description: "Delivered at site gate 2.",
    shippingAddress: "Sample Site, Plot 14, Ring Road, Surat 395002",
    company: {
      name: "Your Company Name",
      address: "Ground Floor, Business Park, Surat, 395007",
      gstNo: "24AAACX0000X1Z5",
      panNo: "AAACX0000X",
      stateName: "Gujarat",
      stateCode: "24",
      bankName: "Sample Bank",
      bankBranch: "Main Branch",
      accountNo: "000000000000",
      ifscCode: "SMPL0000001",
    },
    party: {
      name: sales ? "Sample Buyer Pvt Ltd" : "Sample Supplier Pvt Ltd",
      address: "12 Market Road, Ahmedabad, 380009",
      gstNo: "24AAAFS0000S1Z2",
      stateName: "Gujarat",
      stateCode: "24",
      mobile: "98790 00000",
      email: null,
    },
    lines: LINES,
    totals: {
      totalQuantity: "114.5",
      subtotal: "231000.00",
      totalDiscount: "1000.00",
      totalGstAmount: "38260.00",
      tds: "0.00",
      roundOff: "0.00",
      totalAmount: "269260.00",
    },
    taxSummary: summariseTax(LINES),
    amountInWords: amountInWords("269260.00"),
    taxInWords: amountInWords("38260.00"),
  };
}
