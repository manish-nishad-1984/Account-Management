using AccountManagement.API;
using AccountManagement.Repository.Domain;
using AccountManagement.DBContext.Models.ViewModels.InvoiceMaster;
using AccountManagement.DBContext.Models.ViewModels.SalesMaster;
using AccountManagement.DBContext.Models.API;
using AccountManagement.Repository.Interface.Repository.Sales;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Text.RegularExpressions;
using AccountManagement.DBContext.Models.ViewModels.ItemMaster;
using AccountManagement.DBContext.Models.DataTableParameters;
using AccountManagement.Repository.Interface.Repository.InvoiceMaster;
using System.Formats.Asn1;

#nullable disable

namespace AccountManagement.Repository.Repository.SalesRepository
{
    public class SalesRepo : ISalesInvoice
    {
        public SalesRepo(DbaccManegmentContext context)
        {
            Context = context;
        }
        public DbaccManegmentContext Context { get; }

        public string CheckSalesInvoiceNo(Guid? CompanyId)
        {
            try
            {
                var CompanyDetails = Context.Companies.FirstOrDefault(e => e.CompanyId == CompanyId);
                if (CompanyDetails == null)
                {
                    throw new Exception("Company details not found.");
                }
                else
                {
                    var lastInvoice = Context.SalesInvoices
                        .Where(a => a.CompanyId == CompanyId && a.SalesInvoiceNo != "PayIn")
                        .OrderByDescending(e => e.CreatedOn)
                        .FirstOrDefault();

                    var currentDate = DateTime.Now;
                    int currentYear = FinancialYear.CurrentAsProduced(currentDate).EndYear;
                    int lastYear = currentYear - 1;

                    string SalesInvoiceId;
                    string trimmedInvoicePef = CompanyDetails.InvoicePef.Trim();
                    if (lastInvoice == null)
                    {
                        SalesInvoiceId = $"{trimmedInvoicePef}/{(lastYear % 100):D2}-{(currentYear % 100):D2}/001";
                    }
                    else
                    {
                        string lastInvoiceNumber = lastInvoice.SalesInvoiceNo.Substring(lastInvoice.SalesInvoiceNo.LastIndexOf('/') + 1);
                        Match match = Regex.Match(lastInvoiceNumber, @"\d+$");
                        if (match.Success)
                        {
                            int lastInvoiceNumberValue = int.Parse(match.Value);
                            int newInvoiceNumberValue = lastInvoiceNumberValue + 1;
                            SalesInvoiceId = $"{trimmedInvoicePef}/{(lastYear % 100):D2}-{(currentYear % 100):D2}/{newInvoiceNumberValue:D3}";
                        }
                        else
                        {
                            throw new Exception("Sales invoice id does not have the expected format.");
                        }
                    }
                    return SalesInvoiceId;
                }
            }
            catch (Exception ex)
            {
                string error;
                error = "Error generating sales invoice number.";
                return error;
            }
        }

        public async Task<ApiResponseModel> InsertSalesInvoiceDetails(SalesInvoiceMasterModel SalesInvoiceDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                bool PayOut;
                if (SalesInvoiceDetails.PaymentStatus == "Unpaid")
                {
                    PayOut = false;
                }
                else
                {
                    PayOut = true;
                }

                var salesInvoice = new SalesInvoice()
                {
                    Id = Guid.NewGuid(),
                    SalesInvoiceNo = SalesInvoiceDetails.SalesInvoiceNo,
                    InvoiceType = SalesInvoiceDetails.InvoiceType,
                    SiteId = SalesInvoiceDetails.SiteId,
                    SupplierId = SalesInvoiceDetails.SupplierId,
                    CompanyId = SalesInvoiceDetails.CompanyId,
                    SupplierInvoiceNo = SalesInvoiceDetails.SupplierInvoiceNo,
                    Date = SalesInvoiceDetails.Date,
                    ChallanNo = SalesInvoiceDetails.ChallanNo,
                    Lrno = SalesInvoiceDetails.Lrno,
                    VehicleNo = SalesInvoiceDetails.VehicleNo,
                    DispatchBy = SalesInvoiceDetails.DispatchBy,
                    PaymentTerms = SalesInvoiceDetails.PaymentTerms,
                    Description = SalesInvoiceDetails.Description,
                    TotalAmount = SalesInvoiceDetails.TotalAmount,
                    TotalGstamount = SalesInvoiceDetails.TotalGstamount,
                    TotalDiscount = SalesInvoiceDetails.TotalDiscount,
                    DiscountRoundoff = SalesInvoiceDetails.DiscountRoundoff,
                    Tds = SalesInvoiceDetails.Tds,
                    PaymentStatus = SalesInvoiceDetails.PaymentStatus,
                    IsPayOut = PayOut,
                    ContactName = SalesInvoiceDetails.ContactName,
                    ContactNumber = SalesInvoiceDetails.ContactNumber,
                    ShippingAddress = SalesInvoiceDetails.ShippingAddress,
                    IsApproved = true,
                    CreatedBy = SalesInvoiceDetails.CreatedBy,
                    CreatedOn = DateTime.Now,
                };
                Context.SalesInvoices.Add(salesInvoice);

                foreach (var item in SalesInvoiceDetails.SalesInvoiceDetails)
                {
                    var salesInvoiceDetail = new SalesInvoiceDetail()
                    {
                        RefSalesInvoiceId = salesInvoice.Id,
                        ItemId = item.ItemId,
                        ItemName = item.ItemName,
                        ItemDescription = item.ItemDescription,
                        UnitTypeId = item.UnitTypeId,
                        Quantity = item.Quantity,
                        Price = item.Price,
                        DiscountPer = item.DiscountPer,
                        DiscountAmount = item.DiscountAmount,
                        Gstper = item.Gstper,
                        Gst = item.Gst,
                        TotalAmount = item.TotalAmount,
                        Date = salesInvoice.Date,
                        CreatedBy = salesInvoice.CreatedBy,
                        CreatedOn = DateTime.Now,

                    };
                    Context.SalesInvoiceDetails.Add(salesInvoiceDetail);
                }

                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "SalesInvoice inserted successfully.";
                response.data = salesInvoice.Id;
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error creating invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<SalesInvoiceListView> GetSalesList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                var supplierDataQuery = from a in Context.SalesInvoices
                                        join e in Context.SalesInvoiceDetails on a.Id equals e.RefSalesInvoiceId
                                        join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                                        join c in Context.Companies on a.CompanyId equals c.CompanyId
                                        join d in Context.Sites on a.SiteId equals d.SiteId into siteJoin
                                        from d in siteJoin.DefaultIfEmpty()
                                        join f in Context.ItemMasters on e.ItemId equals f.ItemId
                                        orderby a.Date
                                        select new
                                        {
                                            SalesInvoice = new SalesInvoiceMasterModel
                                            {
                                                Id = a.Id,
                                                SalesInvoiceNo = a.SalesInvoiceNo,
                                                SiteId = a.SiteId,
                                                SupplierId = a.SupplierId,
                                                TotalAmount = a.TotalAmount,
                                                TotalDiscount = a.TotalDiscount,
                                                TotalGstamount = a.TotalGstamount,
                                                Description = a.Description,
                                                Tds = a.Tds,
                                                CompanyId = a.CompanyId,
                                                Date = a.Date,
                                                CompanyName = c.CompanyName,
                                                SiteName = d == null ? "No Site Assigned" : d.SiteName,
                                                SupplierName = b.SupplierName,
                                                CreatedOn = a.CreatedOn,
                                                IsApproved = a.IsApproved,
                                                SupplierInvoiceNo = a.SupplierInvoiceNo,
                                            },
                                            Item = new SalesInvoiceDetailsModel
                                            {
                                                RefSalesInvoiceId = e.RefSalesInvoiceId,
                                                ItemId = e.ItemId,
                                                ItemName = f.ItemName
                                            }
                                        };


                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    supplierDataQuery = supplierDataQuery.Where(u =>
                        u.SalesInvoice.SiteName.ToLower().Contains(searchText) ||
                        u.SalesInvoice.CompanyName.ToLower().Contains(searchText) ||
                        u.SalesInvoice.SupplierName.ToLower().Contains(searchText) ||
                        u.SalesInvoice.SalesInvoiceNo.ToLower().Contains(searchText) ||
                        u.SalesInvoice.TotalAmount.ToString().Contains(searchText) ||
                        u.Item.ItemName.ToLower().Contains(searchText) ||
                        u.SalesInvoice.Date.ToString().Contains(searchText)
                    );
                }
                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "companyname":
                            supplierDataQuery = supplierDataQuery.Where(u => u.SalesInvoice.CompanyName.ToLower().Contains(searchText));
                            break;
                    }
                }
                if (!string.IsNullOrEmpty(sortBy))
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "date":
                            supplierDataQuery = sortOrder == "ascending"
                                ? supplierDataQuery.OrderBy(u => u.SalesInvoice.Date)
                                : supplierDataQuery.OrderByDescending(u => u.SalesInvoice.Date);
                            break;
                        case "companyname":
                            supplierDataQuery = sortOrder == "ascending"
                                ? supplierDataQuery.OrderBy(u => u.SalesInvoice.CompanyName)
                                : supplierDataQuery.OrderByDescending(u => u.SalesInvoice.CompanyName);
                            break;
                    }
                }
                else
                {
                    supplierDataQuery = supplierDataQuery.OrderByDescending(u => u.SalesInvoice.Date);
                }

                var supplierData = await supplierDataQuery.ToListAsync();

                var groupedByRefInvoiceId = supplierData
                    .GroupBy(x => x.Item.RefSalesInvoiceId)
                    .ToDictionary(
                        g => g.Key,
                        g => g.Select(x => x.Item).ToList()
                    );

                var invoicesGroupedById = supplierData
                    .GroupBy(x => x.SalesInvoice.Id)
                    .Select(g => new
                    {
                        Invoice = g.First().SalesInvoice,
                        Items = groupedByRefInvoiceId.ContainsKey(g.Key)
                            ? groupedByRefInvoiceId[g.Key]
                            : new List<SalesInvoiceDetailsModel>()
                    })
                    .ToList();

                return new SalesInvoiceListView
                {
                    SalesInvoiceList = invoicesGroupedById.Select(g => g.Invoice).ToList(),
                    SalesInvoiceItemList = invoicesGroupedById.ToDictionary(g => g.Invoice.Id, g => g.Items.AsEnumerable())
                };
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<SalesInvoiceMasterModel> EditSalesInvoiceDetails(Guid Id)
        {
            SalesInvoiceMasterModel SalesList = new SalesInvoiceMasterModel();
            try
            {
                SalesList = (from a in Context.SalesInvoices.Where(x => x.Id == Id)
                             join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                             join c in Context.Companies on a.CompanyId equals c.CompanyId
                             join d in Context.Sites on a.SiteId equals d.SiteId into siteGroup
                             from d in siteGroup.DefaultIfEmpty()
                             join e in Context.Cities on c.CityId equals e.CityId
                             join f in Context.States on c.StateId equals f.StatesId
                             join g in Context.Countries on c.Country equals g.CountryId
                             join supCity in Context.Cities on b.City equals supCity.CityId
                             join supState in Context.States on b.State equals supState.StatesId
                             join h in Context.GroupMasters on a.SiteId equals h.SiteId into gj
                             from subgroup in gj.DefaultIfEmpty()
                             select new SalesInvoiceMasterModel
                             {
                                 Id = a.Id,
                                 SalesInvoiceNo = a.SalesInvoiceNo,
                                 InvoiceType = a.InvoiceType,
                                 SiteId = a.SiteId,
                                 SiteName = d != null ? d.SiteName : " ",
                                 SupplierId = a.SupplierId,
                                 SupplierName = b.SupplierName,
                                 SupplierStateCode = supState.StateCode,
                                 SupplierStateName = supState.StatesName,
                                 Description = a.Description,
                                 SupplierGstNo = b.Gstno,
                                 CompanyId = a.CompanyId,
                                 CompanyName = c.CompanyName,
                                 CompanyAccountNo = c.AccountNo,
                                 CompanyBankBranch = c.BankBranch,
                                 CompanyBankName = c.BankName,
                                 CompanyIffccode = c.Iffccode,
                                 SupplierInvoiceNo = a.SupplierInvoiceNo,
                                 CompanyGstNo = c.Gstno,
                                 CompanyStateCode = f.StateCode,
                                 CompanyStateName = f.StatesName,
                                 SupplierMobileNo = b.Mobile,
                                 Date = a.Date,
                                 TotalAmount = a.TotalAmount,
                                 TotalDiscount = a.TotalDiscount,
                                 TotalGstamount = a.TotalGstamount,
                                 PaymentStatus = a.PaymentStatus,
                                 IsPayOut = a.IsPayOut,
                                 Tds = a.Tds,
                                 ChallanNo = a.ChallanNo,
                                 Lrno = a.Lrno,
                                 VehicleNo = a.VehicleNo,
                                 DispatchBy = a.DispatchBy,
                                 PaymentTerms = a.PaymentTerms,
                                 ContactName = a.ContactName,
                                 ContactNumber = a.ContactNumber,
                                 CreatedOn = a.CreatedOn,
                                 IsApproved = a.IsApproved,
                                 DiscountRoundoff = a.DiscountRoundoff,
                                 CompanyFullAddress = c.Address + "-" + c.Area + "," + e.CityName + "," + f.StatesName,
                                 SupplierFullAddress = b.BuildingName + "-" + b.Area + "," + supCity.CityName + "," + supState.StatesName,
                                 ShippingAddress = a.ShippingAddress,
                             }).FirstOrDefault();
                List<POItemDetailsModel> itemlist = (from a in Context.SalesInvoiceDetails.Where(a => a.RefSalesInvoiceId == SalesList.Id)
                                                     join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                                     join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                                     select new POItemDetailsModel
                                                     {
                                                         ItemId = a.ItemId,
                                                         ItemName = i.ItemName,
                                                         ItemDescription = a.ItemDescription,
                                                         Quantity = a.Quantity,
                                                         Gstamount = a.Gst,
                                                         TotalAmount = a.TotalAmount,
                                                         UnitType = a.UnitTypeId,
                                                         UnitTypeName = b.UnitName,
                                                         PricePerUnit = a.Price,
                                                         GstPercentage = a.Gstper,
                                                         DiscountAmount = a.DiscountAmount,
                                                         DiscountPer = a.DiscountPer,
                                                         Hsncode = i.Hsncode,
                                                     }).ToList();


                SalesList.SalesItemList = itemlist;
                return SalesList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> UpdateSalesInvoiceDetails(SalesInvoiceMasterModel SalesInvoiceDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var salesInvoice = Context.SalesInvoices.Where(e => e.Id == SalesInvoiceDetails.Id).FirstOrDefault();
                if (salesInvoice != null)
                {
                    salesInvoice.SalesInvoiceNo = SalesInvoiceDetails.SalesInvoiceNo;
                    salesInvoice.InvoiceType = SalesInvoiceDetails.InvoiceType;
                    salesInvoice.SiteId = SalesInvoiceDetails.SiteId;
                    salesInvoice.SupplierId = SalesInvoiceDetails.SupplierId;
                    salesInvoice.CompanyId = SalesInvoiceDetails.CompanyId;
                    salesInvoice.SupplierInvoiceNo = SalesInvoiceDetails.SupplierInvoiceNo;
                    salesInvoice.Date = SalesInvoiceDetails.Date;
                    salesInvoice.ChallanNo = SalesInvoiceDetails.ChallanNo;
                    salesInvoice.Lrno = SalesInvoiceDetails.Lrno;
                    salesInvoice.VehicleNo = SalesInvoiceDetails.VehicleNo;
                    salesInvoice.DispatchBy = SalesInvoiceDetails.DispatchBy;
                    salesInvoice.PaymentTerms = SalesInvoiceDetails.PaymentTerms;
                    salesInvoice.Description = SalesInvoiceDetails.Description;
                    salesInvoice.TotalAmount = SalesInvoiceDetails.TotalAmount;
                    salesInvoice.TotalGstamount = SalesInvoiceDetails.TotalGstamount;
                    salesInvoice.TotalDiscount = SalesInvoiceDetails.TotalDiscount;
                    salesInvoice.DiscountRoundoff = SalesInvoiceDetails.DiscountRoundoff;
                    salesInvoice.Tds = SalesInvoiceDetails.Tds;
                    salesInvoice.PaymentStatus = SalesInvoiceDetails.PaymentStatus;
                    salesInvoice.IsPayOut = SalesInvoiceDetails.IsPayOut;
                    salesInvoice.ContactName = SalesInvoiceDetails.ContactName;
                    salesInvoice.ContactNumber = SalesInvoiceDetails.ContactNumber;
                    salesInvoice.ShippingAddress = SalesInvoiceDetails.ShippingAddress;
                    salesInvoice.UpdatedBy = SalesInvoiceDetails.UpdatedBy;
                    salesInvoice.UpdatedOn = DateTime.Now;
                }
                Context.SalesInvoices.Update(salesInvoice);

                var existingItems = Context.SalesInvoiceDetails
             .Where(e => e.RefSalesInvoiceId == salesInvoice.Id)
             .ToList();

                Context.SalesInvoiceDetails.RemoveRange(existingItems);
                await Context.SaveChangesAsync();

                foreach (var item in SalesInvoiceDetails.SalesInvoiceDetails)
                {
                    var salesInvoiceDetail = new SalesInvoiceDetail()
                    {
                        RefSalesInvoiceId = salesInvoice.Id,
                        ItemId = item.ItemId,
                        ItemName = item.ItemName,
                        ItemDescription = item.ItemDescription,
                        UnitTypeId = item.UnitTypeId,
                        Quantity = item.Quantity,
                        Price = item.Price,
                        DiscountPer = item.DiscountPer,
                        DiscountAmount = item.DiscountAmount,
                        Gstper = item.Gstper,
                        Gst = item.Gst,
                        TotalAmount = item.TotalAmount,
                        Date = salesInvoice.Date,
                        CreatedBy = salesInvoice.CreatedBy,
                        CreatedOn = salesInvoice.CreatedOn,
                        UpdatedBy = salesInvoice.UpdatedBy,
                        UpdatedOn = DateTime.Now,
                    };
                    Context.SalesInvoiceDetails.Add(salesInvoiceDetail);
                }
                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "SalesInvoice updated successfully.";
                response.data = salesInvoice.Id;
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error creating SalesInvoice: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> DeleteSalesInvoiceDetails(Guid Id)
        {
            var response = new ApiResponseModel();
            try
            {
                var SalesDetails = Context.SalesInvoices.Where(a => a.Id == Id).FirstOrDefault();
                if (SalesDetails != null)
                {
                    var SalesItemDetails = Context.SalesInvoiceDetails.Where(a => a.RefSalesInvoiceId == Id).ToList();
                    if (SalesItemDetails != null)
                    {
                        foreach (var item in SalesItemDetails)
                        {
                            Context.SalesInvoiceDetails.Remove(item);
                        }
                    }
                    Context.SalesInvoices.Remove(SalesDetails);
                    Context.SaveChanges();
                    response.code = (int)HttpStatusCode.OK;
                    response.message = "SalesDetails Deleted successfully.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in deleing SalesDetails!";
                }
                return response;
            }
            catch (Exception)
            {
                throw;
            }
        }

        public async Task<IEnumerable<InventoryInwardView>> GetInventoryList(string searchText, string searchBy, string sortBy)
        {
            try
            {
                var InventoryInwardList = from a in Context.InventoryInwards
                                          join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                          join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                          where a.IsDeleted == false
                                          select new InventoryInwardView
                                          {
                                              Id = a.Id,
                                              ItemName = i.ItemName,
                                              ItemId = a.ItemId,
                                              Date = a.Date,
                                              Quantity = a.Quantity,
                                              UnitTypeId = a.UnitTypeId,
                                              UnitName = b.UnitName,
                                              CreatedBy = a.CreatedBy,
                                              CreatedOn = a.CreatedOn,
                                              IsApproved = a.IsApproved,

                                          };


                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    InventoryInwardList = InventoryInwardList.Where(u =>
                        u.UnitName.ToLower().Contains(searchText) ||
                        u.Quantity.ToString().Contains(searchText) ||
                        u.ItemName.ToLower().Contains(searchText)
                    );
                }

                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "unitname":
                            InventoryInwardList = InventoryInwardList.Where(u => u.UnitName.ToLower().Contains(searchText));
                            break;
                        case "itemname":
                            InventoryInwardList = InventoryInwardList.Where(u => u.ItemName.ToLower().Contains(searchText));
                            break;
                        default:

                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {

                    InventoryInwardList = InventoryInwardList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "item":
                            InventoryInwardList = sortOrder == "ascending" ? InventoryInwardList.OrderBy(u => u.ItemName) : InventoryInwardList.OrderByDescending(u => u.ItemName);
                            break;
                        case "createdon":
                            InventoryInwardList = sortOrder == "ascending" ? InventoryInwardList.OrderBy(u => u.CreatedOn) : InventoryInwardList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:

                            break;
                    }
                }

                return await InventoryInwardList.ToListAsync();
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> InsertInventoryDetails(InventoryInwardView InventoryDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var InventoryInvoice = new InventoryInward()
                {
                    Id = Guid.NewGuid(),
                    ItemId = InventoryDetails.ItemId,
                    Item = InventoryDetails.ItemName,
                    UnitTypeId = InventoryDetails.UnitTypeId,
                    Quantity = InventoryDetails.Quantity,
                    Date = InventoryDetails.Date,
                    Details = InventoryDetails.Details,
                    IsApproved = true,
                    IsDeleted = false,
                    CreatedOn = DateTime.Now,
                    CreatedBy = InventoryDetails.CreatedBy,
                };
                Context.InventoryInwards.Add(InventoryInvoice);

                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "Inventory Invoice inserted successfully.";
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error creating invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<InventoryInwardView> EditInventoryDetails(Guid InventoryId)
        {
            try
            {
                var InventoryInvoice = (from a in Context.InventoryInwards.Where(e => e.Id == InventoryId)
                                        join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                        select new InventoryInwardView
                                        {
                                            ItemId = a.ItemId,
                                            ItemName = a.Item,
                                            UnitTypeId = a.UnitTypeId,
                                            Quantity = a.Quantity,
                                            Date = a.Date,
                                            Details = a.Details,
                                            UnitName = b.UnitName,
                                            Id = a.Id,
                                            IsApproved = a.IsApproved,
                                        }).FirstOrDefault();
                return InventoryInvoice;
            }
            catch (Exception)
            {
                throw;
            }
        }

        public async Task<ApiResponseModel> UpdateInventoryDetails(InventoryInwardView InventoryDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var InventoryInvoice = Context.InventoryInwards.Where(e => e.Id == InventoryDetails.Id).FirstOrDefault();
                if (InventoryInvoice != null)
                {
                    InventoryInvoice.ItemId = InventoryDetails.ItemId;
                    InventoryInvoice.Item = InventoryDetails.ItemName;
                    InventoryInvoice.UnitTypeId = InventoryDetails.UnitTypeId;
                    InventoryInvoice.Quantity = InventoryDetails.Quantity;
                    InventoryInvoice.Date = InventoryDetails.Date;
                    InventoryInvoice.Details = InventoryDetails.Details;
                    InventoryInvoice.UpdatedOn = DateTime.Now;
                    InventoryInvoice.UpdatedBy = InventoryDetails.CreatedBy;
                }
                ;
                Context.InventoryInwards.Update(InventoryInvoice);

                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "Inventory Invoice updated successfully.";
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error creating invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> DeleteInventoryDetails(Guid InventoryId)
        {
            var response = new ApiResponseModel();
            try
            {
                var InventoryInvoice = Context.InventoryInwards.Where(e => e.Id == InventoryId).FirstOrDefault();
                if (InventoryInvoice != null)
                {
                    InventoryInvoice.IsDeleted = true;
                    Context.InventoryInwards.Remove(InventoryInvoice);
                    Context.SaveChanges();

                    response.code = (int)HttpStatusCode.OK;
                    response.message = "Inventory deleted successfully.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in deleting inventory!";
                }
                return response;
            }
            catch (Exception)
            {
                throw;
            }
        }

        public async Task<ApiResponseModel> ApproveInventoryDetails(Guid InventoryId)
        {
            var response = new ApiResponseModel();
            try
            {
                var InventoryInvoice = Context.InventoryInwards.Where(e => e.Id == InventoryId).FirstOrDefault();
                if (InventoryInvoice != null)
                {
                    if (InventoryInvoice.IsApproved == true)
                    {
                        InventoryInvoice.IsApproved = false;

                        response.code = (int)HttpStatusCode.OK;
                        response.message = "Inventory unapproved successfully.";
                    }
                    else
                    {
                        InventoryInvoice.IsApproved = true;

                        response.code = (int)HttpStatusCode.OK;
                        response.message = "Inventory approved successfully.";
                    }
                    Context.InventoryInwards.Update(InventoryInvoice);
                    Context.SaveChanges();
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in approve inventory!";
                }
                return response;
            }
            catch (Exception)
            {
                throw;
            }
        }

        public async Task<jsonData> SalesInvoiceReport(DataTableRequstModel SalesReport)
        {
            try
            {
                var supplierInvoicesQuery = from s in Context.SalesInvoices
                                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                                            select new
                                            {
                                                s,
                                                SupplierName = b.SupplierName,
                                                CompanyName = c.CompanyName,
                                                Date = s.Date,
                                                TotalAmount = s.TotalAmount,
                                            };

                if (SalesReport.CompanyId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.CompanyId == SalesReport.CompanyId.Value);
                }

                if (SalesReport.SupplierId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SupplierId == SalesReport.SupplierId.Value);
                }

                if (!string.IsNullOrEmpty(SalesReport.filterType))
                {
                    if (SalesReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (SalesReport.filterType == "tillMonth")
                    {
                        var tillMonth = SalesReport.TillMonth.Value;
                        int year = tillMonth.Year;
                        int month = tillMonth.Month;

                        var startDate = new DateTime(year, 1, 1);
                        var endDate = new DateTime(year, month, 1).AddDays(-1);

                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (SalesReport.filterType == "currentYear")
                    {
                        var currentYear = DateTime.Now.Year;
                        var startOfFinancialYear = new DateTime(currentYear, 4, 1);

                        if (DateTime.Now < startOfFinancialYear)
                        {
                            startOfFinancialYear = startOfFinancialYear.AddYears(-1);
                        }

                        var endOfFinancialYear = startOfFinancialYear.AddYears(1).AddDays(-1);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startOfFinancialYear && s.s.Date <= endOfFinancialYear);
                    }
                    else if (SalesReport.filterType == "betweenYear" && !string.IsNullOrEmpty(SalesReport.SelectedYear))
                    {
                        var years = SalesReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = years[1].Length == 2
                            ? int.Parse(years[1]) + (startYear / 100) * 100
                            : int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear);
                    }
                }

                if (SalesReport.startDate.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= SalesReport.startDate.Value);
                }

                if (SalesReport.endDate.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date <= SalesReport.endDate.Value);
                }

                var CountTotalData = await supplierInvoicesQuery
                    .GroupBy(g => new { g.s.SupplierId })
                    .Select(group => new SalesInvoiceMasterModel
                    {
                        Id = group.FirstOrDefault().s.Id,
                        SalesInvoiceNo = group.FirstOrDefault().s.SalesInvoiceNo,
                        SupplierId = group.Key.SupplierId,
                        CompanyId = group.FirstOrDefault().s.CompanyId,
                        Description = string.Join(", ", group.Select(x => x.s.Description)),
                        CompanyName = group.FirstOrDefault().CompanyName,
                        SupplierName = group.FirstOrDefault().SupplierName,
                        PaymentStatus = group.FirstOrDefault().s.PaymentStatus,
                        IsPayOut = group.FirstOrDefault().s.IsPayOut,
                        SupplierInvoiceNo = group.FirstOrDefault().s.SupplierInvoiceNo,
                        Date = group.FirstOrDefault().s.Date,
                        CreatedOn = group.FirstOrDefault().s.CreatedOn,
                        TotalAmount = group.FirstOrDefault().s.TotalAmount,
                        PayOutTotalAmount = group.Where(x => x.s.SalesInvoiceNo == "PayIn" || x.s.InvoiceType == "Sales Return" || x.s.InvoiceType == "Credit Note").Sum(x => x.s.TotalAmount),
                        NonPayOutTotalAmount = group.Where(x => x.s.SalesInvoiceNo != "PayIn" && x.s.InvoiceType != "Sales Return" && x.s.InvoiceType != "Credit Note").Sum(x => x.s.TotalAmount),
                        NetAmount = group.Sum(x => x.s.SalesInvoiceNo != "PayIn" ? x.s.TotalAmount : -x.s.TotalAmount),
                    })
                    .ToListAsync();

                var TotalCredit = CountTotalData.Sum(i => i.NonPayOutTotalAmount);

                var TotalDebit = CountTotalData.Sum(i => i.PayOutTotalAmount);

                if (!string.IsNullOrEmpty(SalesReport.sortColumn) && !string.IsNullOrEmpty(SalesReport.sortColumnDir))
                {
                    switch (SalesReport.sortColumn.ToLower())
                    {
                        case "suppliername":
                            CountTotalData = SalesReport.sortColumnDir == "asc"
                                ? CountTotalData.OrderBy(s => s.SupplierName).ToList()
                                : CountTotalData.OrderByDescending(s => s.SupplierName).ToList();
                            break;

                        case "companyname":
                            CountTotalData = SalesReport.sortColumnDir == "asc"
                                ? CountTotalData.OrderBy(s => s.CompanyName).ToList()
                                : CountTotalData.OrderByDescending(s => s.CompanyName).ToList();
                            break;
                    }
                }
                var totalRecords = CountTotalData.Count();
                var TotalData = CountTotalData.ToList();
                var TotalAmount = CountTotalData.Sum(i => i.TotalAmount);
                var jsonData = new jsonData
                {
                    draw = SalesReport.draw,
                    recordsFiltered = totalRecords,
                    recordsTotal = totalRecords,
                    data = TotalData,
                    TotalCredit = TotalCredit,
                    TotalDebit = TotalDebit,
                };

                return jsonData;
            }
            catch (Exception ex)
            {
                throw new Exception("An error occurred while fetching invoice details.", ex);
            }
        }

        public async Task<ApiResponseModel> InsertSalesPayInInvoice(List<SalesInvoiceMasterModel> slaesPayInDetails)
        {
            var response = new ApiResponseModel();
            try
            {
                if (slaesPayInDetails == null || !slaesPayInDetails.Any())
                {
                    response.code = (int)HttpStatusCode.BadRequest;
                    response.message = "No data provided.";
                    return response;
                }
                foreach (var invoiceDetail in slaesPayInDetails)
                {
                    var salesInvoice = new SalesInvoice
                    {
                        Id = Guid.NewGuid(),
                        SalesInvoiceNo = invoiceDetail.SalesInvoiceNo,
                        SiteId = invoiceDetail.SiteId,
                        SupplierId = invoiceDetail.SupplierId,
                        CompanyId = invoiceDetail.CompanyId,
                        TotalAmount = invoiceDetail.TotalAmount,
                        Description = invoiceDetail.Description,
                        Date = invoiceDetail.Date,
                        TotalDiscount = invoiceDetail.TotalDiscount,
                        TotalGstamount = invoiceDetail.TotalGstamount,
                        Tds = invoiceDetail.Tds,
                        IsPayOut = true,
                        PaymentStatus = invoiceDetail.PaymentStatus,
                        CreatedBy = invoiceDetail.CreatedBy,
                        CreatedOn = DateTime.Now,
                    };
                    Context.SalesInvoices.Add(salesInvoice);
                }
                await Context.SaveChangesAsync();

                response.code = (int)HttpStatusCode.OK;
                response.message = "Payments processed successfully.";
            }
            catch (Exception ex)
            {
                response.code = (int)HttpStatusCode.InternalServerError;
                response.message = "An error occurred while processing your request.";
            }
            return response;
        }

        public async Task<jsonData> SalesInvoicePaymentReport(DataTableRequstModel SalesPaymentReport)
        {
            try
            {
                var query = from s in Context.SalesInvoices
                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId into suppliers
                            from b in suppliers.DefaultIfEmpty()
                            join c in Context.Companies on s.CompanyId equals c.CompanyId into companies
                            from c in companies.DefaultIfEmpty()
                            join d in Context.Sites on s.SiteId equals d.SiteId into sites
                            from d in sites.DefaultIfEmpty()
                            select new
                            {
                                s,
                                SupplierName = b != null ? b.SupplierName : null,
                                SalesInvoiceNo = s.SalesInvoiceNo,
                                TotalAmount = s.TotalAmount,
                                CompanyName = c != null ? c.CompanyName : null,
                                SiteName = d != null ? d.SiteName : null,
                                Date = s.Date
                            };


                if (SalesPaymentReport.CompanyId.HasValue)
                {
                    query = query.Where(s => s.s.CompanyId == SalesPaymentReport.CompanyId.Value);
                }
                if (SalesPaymentReport.SiteId.HasValue)
                {
                    query = query.Where(s => s.s.SiteId == SalesPaymentReport.SiteId.Value);
                }
                if (SalesPaymentReport.SupplierId.HasValue)
                {
                    query = query.Where(s => s.s.SupplierId == SalesPaymentReport.SupplierId.Value);
                }

                if (!string.IsNullOrEmpty(SalesPaymentReport.sortColumn) && !string.IsNullOrEmpty(SalesPaymentReport.sortColumnDir))
                {

                    var queryType = query.FirstOrDefault().GetType();

                    switch (SalesPaymentReport.sortColumn.ToLower())
                    {
                        case "suppliername":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.SupplierName)
                                : query.OrderByDescending(s => s.SupplierName);
                            break;
                        case "companyname":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.CompanyName)
                                : query.OrderByDescending(s => s.CompanyName);
                            break;
                        case "salesinvoiceno":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.SalesInvoiceNo)
                                : query.OrderByDescending(s => s.SalesInvoiceNo);
                            break;
                        case "sitename":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.SiteName)
                                : query.OrderByDescending(s => s.SiteName);
                            break;
                        case "credit":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.TotalAmount)
                                : query.OrderByDescending(s => s.TotalAmount);
                            break;
                        case "debit":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.TotalAmount)
                                : query.OrderByDescending(s => s.TotalAmount);
                            break;
                        case "date":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.Date)
                                : query.OrderByDescending(s => s.Date);
                            break;
                        case "totalamount":
                            query = SalesPaymentReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.TotalAmount)
                                : query.OrderByDescending(s => s.TotalAmount);
                            break;
                        default:
                            query = query.OrderByDescending(s => s.s.CreatedOn);
                            break;
                    }
                }
                else
                {
                    query = query.OrderBy(s => s.s.Date);
                }

                if (!string.IsNullOrEmpty(SalesPaymentReport.filterType))
                {
                    if (SalesPaymentReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (SalesPaymentReport.filterType == "currentYear")
                    {
                        var currentYear = DateTime.Now.Year;
                        var startOfFinancialYear = new DateTime(currentYear, 4, 1);

                        if (DateTime.Now < startOfFinancialYear)
                        {
                            startOfFinancialYear = startOfFinancialYear.AddYears(-1);
                        }

                        var endOfFinancialYear = startOfFinancialYear.AddYears(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startOfFinancialYear && s.s.Date <= endOfFinancialYear);
                    }
                    else if (SalesPaymentReport.filterType == "betweenYear" && !string.IsNullOrEmpty(SalesPaymentReport.SelectedYear))
                    {

                        var years = SalesPaymentReport.SelectedYear.Split('-');

                        if (years.Length == 2)
                        {

                            int startYear = int.Parse(years[0]);
                            int endYear = int.Parse("20" + years[1]);


                            var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                            var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);


                            query = query.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear);
                        }
                    }

                }

                if (SalesPaymentReport.startDate.HasValue)
                {
                    query = query.Where(s => s.s.Date >= SalesPaymentReport.startDate.Value);
                }
                if (SalesPaymentReport.endDate.HasValue)
                {
                    query = query.Where(s => s.s.Date <= SalesPaymentReport.endDate.Value);
                }
                if (!string.IsNullOrEmpty(SalesPaymentReport.searchValue))
                {
                    query = query.Where(s => s.SupplierName.Contains(SalesPaymentReport.searchValue) ||
                                             s.SalesInvoiceNo.Contains(SalesPaymentReport.searchValue) ||
                                             s.CompanyName.Contains(SalesPaymentReport.searchValue));
                }

                var totalRecords = await query.CountAsync();


                var allData = await query
           .Select(s => new SalesInvoiceMasterModel
           {
               Id = s.s.Id,
               SalesInvoiceNo = s.s.SalesInvoiceNo,
               SiteId = s.s.SiteId,
               SupplierId = s.s.SupplierId,
               CompanyId = s.s.CompanyId,
               TotalAmount = s.s.TotalAmount,
               TotalDiscount = s.s.TotalDiscount,
               TotalGstamount = s.s.TotalGstamount,
               Tds = s.s.Tds,
               Description = s.s.Description,
               CompanyName = s.CompanyName,
               SupplierName = s.SupplierName,
               PaymentStatus = s.s.PaymentStatus,
               IsPayOut = s.s.IsPayOut,
               SupplierInvoiceNo = s.s.SupplierInvoiceNo,
               Date = s.s.Date,
               CreatedOn = s.s.CreatedOn,
               SiteName = s.SiteName,
               InvoiceType = s.s.InvoiceType,
           })
           .ToListAsync();

                var TotalCredit = allData
                    .Where(i => i.SalesInvoiceNo != "PayIn" &&
                        i.InvoiceType != "Sales Return" &&
                        i.InvoiceType != "Credit Note")
                        .Sum(i => i.TotalAmount);

                var TotalDebit = allData
                    .Where(i => i.SalesInvoiceNo == "PayIn" ||
                        i.InvoiceType == "Sales Return" ||
                        i.InvoiceType == "Credit Note")
                        .Sum(i => i.TotalAmount);

                var jsonData = new jsonData
                {
                    draw = SalesPaymentReport.draw,
                    recordsFiltered = totalRecords,
                    recordsTotal = totalRecords,
                    data = allData,
                    TotalCredit = TotalCredit,
                    TotalDebit = TotalDebit,
                };

                return jsonData;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<SalesInvoiceMasterModel> EditSalesPayInInvoice(Guid SalesId)
        {
            SalesInvoiceMasterModel payindetails = new SalesInvoiceMasterModel();
            try
            {
                payindetails = (from a in Context.SalesInvoices.Where(x => x.Id == SalesId)
                                join c in Context.SupplierMasters on a.SupplierId equals c.SupplierId
                                join d in Context.Companies on a.CompanyId equals d.CompanyId
                                select new SalesInvoiceMasterModel
                                {
                                    Id = a.Id,
                                    SalesInvoiceNo = a.SalesInvoiceNo,
                                    SiteId = a.SiteId,
                                    SupplierId = a.SupplierId,
                                    CompanyId = a.CompanyId,
                                    SupplierName = c.SupplierName,
                                    CompanyName = d.CompanyName,
                                    TotalAmount = a.TotalAmount,
                                    Description = a.Description,
                                    Date = a.Date,
                                    IsPayOut = true,
                                    PaymentStatus = a.PaymentStatus,
                                    CreatedBy = a.CreatedBy,
                                    CreatedOn = a.CreatedOn,
                                    DiscountRoundoff = a.DiscountRoundoff,
                                    IsApproved = a.IsApproved,
                                }).First();
                return payindetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> UpdateSalesPayInInvoice(SalesInvoiceMasterModel salesPayInDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var payindetails = Context.SalesInvoices.Where(a => a.Id == salesPayInDetails.Id).FirstOrDefault();

                if (payindetails != null)
                {
                    payindetails.Id = salesPayInDetails.Id;
                    payindetails.TotalAmount = salesPayInDetails.TotalAmount;
                    payindetails.PaymentStatus = salesPayInDetails.PaymentStatus;
                    payindetails.Date = salesPayInDetails.Date;
                    payindetails.Description = salesPayInDetails.Description;
                    payindetails.UpdatedBy = salesPayInDetails.UpdatedBy;
                    payindetails.UpdatedOn = DateTime.Now;


                    Context.SalesInvoices.Update(payindetails);
                    Context.SaveChanges();
                    response.code = 200;
                    response.message = "payin invoice is updated successfully.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in updating payin invoice.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error in updating invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> DeleteSalesPayInInvoice(Guid SalesId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var payindetails = Context.SalesInvoices.Where(a => a.Id == SalesId).FirstOrDefault();

                if (payindetails != null)
                {
                    Context.SalesInvoices.Remove(payindetails);
                    Context.SaveChanges();
                    response.code = 200;
                    response.message = "payin invoice is successfully deleted.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in deleting payin invoice.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error in deleting invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<SalesInvoiceTotalAmount> SalesInvoicePdfReport(InvoiceReportModel SalesReport)
        {
            try
            {
                var SalesInvoicesQuery = from s in Context.SalesInvoices
                                         join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                                         join c in Context.Companies on s.CompanyId equals c.CompanyId
                                         select new
                                         {
                                             s,
                                             SupplierName = b.SupplierName,
                                             CompanyName = c.CompanyName,
                                             Date = s.Date,
                                             TotalAmount = s.TotalAmount,

                                         };

                if (SalesReport.CompanyId.HasValue)
                {
                    SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.CompanyId == SalesReport.CompanyId.Value);
                }

                if (SalesReport.SupplierId.HasValue)
                {
                    SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.SupplierId == SalesReport.SupplierId.Value);
                }


                if (!string.IsNullOrEmpty(SalesReport.filterType))
                {
                    if (SalesReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (SalesReport.filterType == "tillMonth")
                    {
                        var tillMonth = SalesReport.TillMonth.Value;
                        int year = tillMonth.Year;
                        int month = tillMonth.Month;

                        var startDate = new DateTime(year, 1, 1);
                        var endDate = new DateTime(year, month, 1).AddDays(-1);

                        SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (SalesReport.filterType == "currentYear")
                    {
                        var currentYear = DateTime.Now.Year;
                        var startOfFinancialYear = new DateTime(currentYear, 4, 1);

                        if (DateTime.Now < startOfFinancialYear)
                        {
                            startOfFinancialYear = startOfFinancialYear.AddYears(-1);
                        }

                        var endOfFinancialYear = startOfFinancialYear.AddYears(1).AddDays(-1);
                        SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.Date >= startOfFinancialYear && s.s.Date <= endOfFinancialYear);
                    }
                    else if (SalesReport.filterType == "betweenYear" && !string.IsNullOrEmpty(SalesReport.SelectedYear))
                    {
                        var years = SalesReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = years[1].Length == 2
                            ? int.Parse(years[1]) + (startYear / 100) * 100
                            : int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);
                        SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear);
                    }
                }

                if (SalesReport.startDate.HasValue)
                {
                    SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.Date >= SalesReport.startDate.Value);
                }

                if (SalesReport.endDate.HasValue)
                {
                    SalesInvoicesQuery = SalesInvoicesQuery.Where(s => s.s.Date <= SalesReport.endDate.Value);
                }

                var SalesInvoiceData = await SalesInvoicesQuery
                   .GroupBy(g => new { g.s.SupplierId })
                   .Select(group => new SalesInvoiceMasterModel
                   {
                       Id = group.FirstOrDefault().s.Id,
                       SalesInvoiceNo = group.FirstOrDefault().s.SalesInvoiceNo,
                       SupplierId = group.Key.SupplierId,
                       CompanyId = group.FirstOrDefault().s.CompanyId,
                       Description = string.Join(", ", group.Select(x => x.s.Description)),
                       CompanyName = group.FirstOrDefault().CompanyName,
                       SupplierName = group.FirstOrDefault().SupplierName,
                       PaymentStatus = group.FirstOrDefault().s.PaymentStatus,
                       IsPayOut = group.FirstOrDefault().s.IsPayOut,
                       SupplierInvoiceNo = group.FirstOrDefault().s.SupplierInvoiceNo,
                       Date = group.FirstOrDefault().s.Date,
                       CreatedOn = group.FirstOrDefault().s.CreatedOn,
                       TotalAmount = group.FirstOrDefault().s.TotalAmount,
                       PayOutTotalAmount = group.Where(x => x.s.SalesInvoiceNo == "PayIn" || x.s.InvoiceType == "Sales Return" || x.s.InvoiceType == "Credit Note").Sum(x => x.s.TotalAmount),
                       NonPayOutTotalAmount = group.Where(x => x.s.SalesInvoiceNo != "PayIn" && x.s.InvoiceType != "Sales Return" && x.s.InvoiceType != "Credit Note").Sum(x => x.s.TotalAmount),
                       NetAmount = group.Sum(x => x.s.SalesInvoiceNo != "PayIn" ? x.s.TotalAmount : -x.s.TotalAmount),
                   })
                   .ToListAsync();

                var totalCredit = SalesInvoiceData.Sum(i => i.NonPayOutTotalAmount);
                var totalDebit = SalesInvoiceData.Sum(i => i.PayOutTotalAmount);
                var totalPending = totalCredit - totalDebit;

                var PayInDetails = new SalesInvoiceTotalAmount
                {
                    SalesInvoiceList = SalesInvoiceData.Where(inv => inv.NetAmount != 0).ToList(),
                    TotalPending = totalPending ?? 0m,
                    TotalCreadit = totalCredit ?? 0m,
                    TotalPurchase = totalDebit ?? 0m
                };

                return PayInDetails;
            }
            catch (Exception ex)
            {
                throw new Exception("An error occurred while fetching invoice details.", ex);
            }
        }

        public async Task<SalesInvoiceTotalAmount> SalesInvoicePaymentPdfReport(InvoiceReportModel SalesPaymentReport)
        {
            try
            {
                var query = from s in Context.SalesInvoices
                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                            select new
                            {
                                s,
                                SupplierName = b.SupplierName,
                                SalesInvoiceNo = s.SalesInvoiceNo,
                                CompanyName = c.CompanyName,
                                Date = s.Date
                            };

                if (SalesPaymentReport.CompanyId.HasValue)
                {
                    query = query.Where(s => s.s.CompanyId == SalesPaymentReport.CompanyId.Value).OrderBy(s => s.s.CreatedOn);
                }

                if (SalesPaymentReport.SupplierId.HasValue)
                {
                    query = query.Where(s => s.s.SupplierId == SalesPaymentReport.SupplierId.Value).OrderBy(s => s.s.CreatedOn);
                }

                if (!string.IsNullOrEmpty(SalesPaymentReport.filterType))
                {
                    if (SalesPaymentReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startDate && s.s.Date <= endDate).OrderBy(s => s.s.CreatedOn);
                    }
                    else if (SalesPaymentReport.filterType == "currentYear")
                    {
                        var currentYear = DateTime.Now.Year;
                        var startOfFinancialYear = new DateTime(currentYear, 4, 1);

                        if (DateTime.Now < startOfFinancialYear)
                        {
                            startOfFinancialYear = startOfFinancialYear.AddYears(-1);
                        }

                        var endOfFinancialYear = startOfFinancialYear.AddYears(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startOfFinancialYear && s.s.Date <= endOfFinancialYear).OrderBy(s => s.s.CreatedOn);
                    }
                    else if (SalesPaymentReport.filterType == "betweenYear" && !string.IsNullOrEmpty(SalesPaymentReport.SelectedYear))
                    {
                        var years = SalesPaymentReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);

                        query = query.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear).OrderBy(s => s.s.CreatedOn);
                    }
                }

                if (SalesPaymentReport.endDate.HasValue)
                {
                    query = query.Where(s => s.s.Date <= SalesPaymentReport.endDate.Value).OrderBy(s => s.s.CreatedOn);
                }

                var totalRecords = await query.CountAsync();

                var SalesInvoiceList = await query.Select(s => new SalesInvoiceMasterModel
                {
                    Id = s.s.Id,
                    SalesInvoiceNo = s.s.SalesInvoiceNo,
                    SiteId = s.s.SiteId,
                    SupplierId = s.s.SupplierId,
                    CompanyId = s.s.CompanyId,
                    TotalAmount = s.s.TotalAmount,
                    TotalDiscount = s.s.TotalDiscount,
                    TotalGstamount = s.s.TotalGstamount,
                    Tds = s.s.Tds,
                    Description = s.s.Description,
                    CompanyName = s.CompanyName,
                    SupplierName = s.SupplierName,
                    PaymentStatus = s.s.PaymentStatus,
                    IsPayOut = s.s.IsPayOut,
                    SupplierInvoiceNo = s.s.SupplierInvoiceNo,
                    Date = s.s.Date,
                    CreatedOn = s.s.CreatedOn,
                    InvoiceType = s.s.InvoiceType,
                }).ToListAsync();

                var CreditTotalAmount = SalesInvoiceList
                    .Where(i => i.SalesInvoiceNo != "PayIn" &&
                        i.InvoiceType != "Sales Return" &&
                        i.InvoiceType != "Credit Note")
                        .Sum(i => i.TotalAmount);

                var DebitTotalAmount = SalesInvoiceList
                    .Where(i => i.SalesInvoiceNo == "PayIn" ||
                        i.InvoiceType == "Sales Return" ||
                        i.InvoiceType == "Credit Note")
                        .Sum(i => i.TotalAmount);

                var PendingTotalAmount = CreditTotalAmount - DebitTotalAmount;

                var PayInDetails = new SalesInvoiceTotalAmount
                {
                    SalesInvoiceList = SalesInvoiceList,
                    TotalPending = PendingTotalAmount,
                    TotalCreadit = CreditTotalAmount,
                    TotalPurchase = DebitTotalAmount
                };

                return PayInDetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
    }
}
