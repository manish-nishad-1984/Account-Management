using AccountManagement.API;
using AccountManagement.Repository.Domain;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.Common;
using AccountManagement.DBContext.Models.DataTableParameters;
using AccountManagement.DBContext.Models.ViewModels.InvoiceMaster;
using AccountManagement.DBContext.Models.ViewModels.ItemMaster;
using AccountManagement.DBContext.Models.ViewModels.PurchaseOrder;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;
using AccountManagement.Repository.Interface.Repository.InvoiceMaster;
using AccountManagement.Repository.Interface.Repository.PurchaseOrder;
using Azure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System;
using System.Collections.Generic;
using System.ComponentModel.Design;
using System.Data;
using System.Data.SqlClient;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Linq.Dynamic;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory;

#nullable disable
namespace AccountManagement.Repository.Repository.InvoiceMasterRepository
{
    public class SupplierInvoiceRepo : ISupplierInvoice
    {
        public SupplierInvoiceRepo(DbaccManegmentContext context, IConfiguration configuration)
        {
            Context = context;
            Configuration = configuration;
        }

        public DbaccManegmentContext Context { get; }
        public IConfiguration Configuration { get; }

        public async Task<ApiResponseModel> AddSupplierInvoice(List<SupplierInvoiceModel> supplierInvoiceDetails)
        {
            var response = new ApiResponseModel();
            try
            {
                if (supplierInvoiceDetails == null || !supplierInvoiceDetails.Any())
                {
                    response.code = (int)HttpStatusCode.BadRequest;
                    response.message = "No data provided.";
                    return response;
                }
                foreach (var invoiceDetail in supplierInvoiceDetails)
                {
                    var supplierInvoice = new SupplierInvoice
                    {
                        Id = Guid.NewGuid(),
                        InvoiceNo = invoiceDetail.InvoiceNo,
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
                    Context.SupplierInvoices.Add(supplierInvoice);
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

        public async Task<ApiResponseModel> DeleteSupplierInvoice(Guid Id)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var SupplierInvoice = Context.SupplierInvoices.Where(a => a.Id == Id).FirstOrDefault();
                var InvoiceItemList = Context.SupplierInvoiceDetails.Where(b => b.RefInvoiceId == Id).ToList();
                if (InvoiceItemList != null)
                {
                    foreach (var item in InvoiceItemList)
                    {
                        Context.SupplierInvoiceDetails.Remove(item);
                    }
                }
                if (SupplierInvoice != null)
                {
                    Context.SupplierInvoices.Remove(SupplierInvoice);
                    response.message = "Supplierinvoice is removed successfully!";
                    response.code = 200;
                }

                Context.SaveChanges();
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return response;
        }

        public async Task<jsonData> GetInvoiceDetailsById(DataTableRequstModel PayOutReport)
        {
            try
            {
                var supplierInvoicesQuery = from s in Context.SupplierInvoices
                                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                                            join d in Context.Sites on s.SiteId equals d.SiteId into siteGroup
                                            from d in siteGroup.DefaultIfEmpty()
                                            select new
                                            {
                                                s,
                                                SupplierName = b.SupplierName,
                                                CompanyName = c.CompanyName,
                                                SiteName = d != null ? d.SiteName : null,
                                                Group = s.SiteGroup,
                                                Date = s.Date,
                                                TotalAmount = s.TotalAmount,

                                            };

                if (PayOutReport.CompanyId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.CompanyId == PayOutReport.CompanyId.Value);
                }

                if (PayOutReport.SiteId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SiteId == PayOutReport.SiteId.Value);
                }

                if (PayOutReport.SupplierId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SupplierId == PayOutReport.SupplierId.Value);
                }

                if (!string.IsNullOrEmpty(PayOutReport.GroupName))
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SiteGroup == PayOutReport.GroupName);
                }

                if (!string.IsNullOrEmpty(PayOutReport.filterType))
                {
                    if (PayOutReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (PayOutReport.filterType == "tillMonth")
                    {
                        var tillMonth = PayOutReport.TillMonth.Value;
                        int year = tillMonth.Year;
                        int month = tillMonth.Month;

                        var startDate = new DateTime(year, 1, 1);
                        var endDate = new DateTime(year, month, 1).AddDays(-1);

                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (PayOutReport.filterType == "currentYear")
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
                    else if (PayOutReport.filterType == "betweenYear" && !string.IsNullOrEmpty(PayOutReport.SelectedYear))
                    {
                        var years = PayOutReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = years[1].Length == 2
                            ? int.Parse(years[1]) + (startYear / 100) * 100
                            : int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear);
                    }
                }

                if (PayOutReport.startDate.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= PayOutReport.startDate.Value);
                }

                if (PayOutReport.endDate.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date <= PayOutReport.endDate.Value);
                }

                var CountTotalData = await supplierInvoicesQuery
    .GroupBy(g => new { g.s.SiteId, g.s.SupplierId })
    .Select(group => new SupplierInvoiceModel
    {
        Id = group.FirstOrDefault().s.Id,
        InvoiceNo = group.FirstOrDefault().s.InvoiceNo,
        SiteId = group.Key.SiteId,
        SupplierId = group.Key.SupplierId,
        CompanyId = group.FirstOrDefault().s.CompanyId,
        PayOutTotalAmount = group.Where(x => x.s.InvoiceNo == "PayOut" || x.s.InvoiceType == "Purchase Return" || x.s.InvoiceType == "Credit Note").Sum(x => x.s.TotalAmount),
        NonPayOutTotalAmount = group.Where(x => x.s.InvoiceNo != "PayOut" && x.s.InvoiceType != "Purchase Return" && x.s.InvoiceType != "Credit Note").Sum(x => x.s.TotalAmount),
        NetAmount = group.Sum(x => x.s.InvoiceNo != "PayOut" ? x.s.TotalAmount : -x.s.TotalAmount),
        GroupName = group.FirstOrDefault().s.SiteGroup,
        Description = string.Join(", ", group.Select(x => x.s.Description)),
        CompanyName = group.FirstOrDefault().CompanyName,
        SupplierName = group.FirstOrDefault().SupplierName,
        PaymentStatus = group.FirstOrDefault().s.PaymentStatus,
        IsPayOut = group.FirstOrDefault().s.IsPayOut,
        SupplierInvoiceNo = group.FirstOrDefault().s.SupplierInvoiceNo,
        Date = group.FirstOrDefault().s.Date,
        CreatedOn = group.FirstOrDefault().s.CreatedOn,
        SiteName = group.FirstOrDefault().SiteName
    })
    .ToListAsync();


                var TotalCredit = CountTotalData.Sum(i => i.NonPayOutTotalAmount);

                var TotalDebit = CountTotalData.Sum(i => i.PayOutTotalAmount);

                if (!string.IsNullOrEmpty(PayOutReport.sortColumn) && !string.IsNullOrEmpty(PayOutReport.sortColumnDir))
                {
                    switch (PayOutReport.sortColumn.ToLower())
                    {
                        case "suppliername":
                            CountTotalData = PayOutReport.sortColumnDir == "asc"
                                ? CountTotalData.OrderBy(s => s.SupplierName).ToList()
                                : CountTotalData.OrderByDescending(s => s.SupplierName).ToList();
                            break;

                        case "sitename":
                            CountTotalData = PayOutReport.sortColumnDir == "asc"
                                ? CountTotalData.OrderBy(s => s.SiteName).ToList()
                                : CountTotalData.OrderByDescending(s => s.SiteName).ToList();
                            break;

                        case "netamount":
                            CountTotalData = PayOutReport.sortColumnDir == "asc"
                                ? CountTotalData.OrderBy(s => s.NetAmount).ToList()
                                : CountTotalData.OrderByDescending(s => s.NetAmount).ToList();
                            break;

                    }
                }
                var TotalData = CountTotalData.Where(i => i.NetAmount != 0).ToList();



                var totalRecords = TotalData.Count();

                var jsonData = new jsonData
                {
                    draw = PayOutReport.draw,
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

        public async Task<SupplierInvoiceMasterView> GetSupplierInvoiceById(Guid Id)
        {
            SupplierInvoiceMasterView supplierList = new SupplierInvoiceMasterView();
            try
            {
                supplierList = (from a in Context.SupplierInvoices.Where(x => x.Id == Id)
                                join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                                join c in Context.Companies on a.CompanyId equals c.CompanyId
                                join d in Context.Sites on a.SiteId equals d.SiteId
                                join e in Context.Cities on c.CityId equals e.CityId
                                join f in Context.States on c.StateId equals f.StatesId
                                join g in Context.Countries on c.Country equals g.CountryId
                                join supCity in Context.Cities on b.City equals supCity.CityId
                                join supState in Context.States on b.State equals supState.StatesId
                                join h in Context.GroupMasters on a.SiteId equals h.SiteId into gj
                                from subgroup in gj.DefaultIfEmpty()
                                select new SupplierInvoiceMasterView
                                {
                                    Id = a.Id,
                                    InvoiceNo = a.InvoiceNo,
                                    InvoiceType = a.InvoiceType,
                                    SiteId = a.SiteId,
                                    SiteName = d.SiteName,
                                    SupplierId = a.SupplierId,
                                    SupplierName = b.SupplierName,
                                    Description = a.Description,
                                    SupplierArea = b.Area,
                                    SupplierAccountNo = b.AccountNo,
                                    SupplierBankName = b.BankName,
                                    SupplierBuildingName = b.BuildingName,
                                    SupplierCity = supCity.CityName,
                                    SupplierGstNo = b.Gstno,
                                    SupplierIFSCCode = b.Iffccode,
                                    SupplierEmail = b.Email,
                                    SupplierState = supState.StatesName,
                                    SupplierPincode = b.PinCode,
                                    CompanyId = a.CompanyId,
                                    CompanyName = c.CompanyName,
                                    CompanyAddress = c.Address,
                                    SupplierInvoiceNo = a.SupplierInvoiceNo,
                                    CompanyArea = c.Area,
                                    CompanyCityName = e.CityName,
                                    CompanyCountryName = g.CountryName,
                                    CompanyStateName = f.StatesName,
                                    CompanyGstNo = c.Gstno,
                                    CompanyPincode = c.Pincode,
                                    CompanyPanNo = c.PanNo,
                                    SupplierMobileNo = b.Mobile,
                                    Date = a.Date,
                                    TotalAmountInvoice = a.TotalAmount,
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
                                    SiteGroup = a.SiteGroup,
                                    ContactName = a.ContactName,
                                    ContactNumber = a.ContactNumber,
                                    CreatedOn = a.CreatedOn,
                                    StateCode = f.StateCode,
                                    IsApproved = a.IsApproved,
                                    GroupAddress = a.GroupAddress,
                                    DiscountRoundoff = a.DiscountRoundoff,
                                    Poid = a.Poid,
                                    CompanyFullAddress = c.Address + "-" + c.Area + "," + e.CityName + "," + f.StatesName,
                                    SupplierFullAddress = b.BuildingName + "-" + b.Area + "," + supCity.CityName + "," + supState.StatesName,
                                    ShippingAddress = a.ShippingAddress,
                                    SiteGroupId = subgroup != null ? subgroup.GroupId : (Guid?)null
                                }).FirstOrDefault();
                List<POItemDetailsModel> itemlist = (from a in Context.SupplierInvoiceDetails.Where(a => a.RefInvoiceId == supplierList.Id)
                                                     join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId into unitJoin
                                                     from b in unitJoin.DefaultIfEmpty()
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
                                                         UnitTypeName = b != null ? b.UnitName : null,
                                                         PricePerUnit = a.Price,
                                                         GstPercentage = a.Gstper,
                                                         DiscountAmount = a.DiscountAmount,
                                                         DiscountPer = a.DiscountPer,
                                                         Hsncode = i.Hsncode,
                                                     }).ToList();


                supplierList.ItemList = itemlist;
                return supplierList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }


        //public async Task<SupplierInvoiceMasterView> GetSupplierInvoiceById(Guid Id)
        //{
        //    try
        //    {
        //        string dbConnectionStr = Configuration.GetConnectionString("ACCDbconn");
        //        var sqlPar = new SqlParameter[]
        //        {
        //            new SqlParameter("@InvoiceId", Id),
        //        };
        //        var DS = DbHelper.GetDataSet("[spGetSupplierInvoiceDetailsById]", System.Data.CommandType.StoredProcedure, sqlPar, dbConnectionStr);

        //        SupplierInvoiceMasterView SupplierInvoiceDetails = new SupplierInvoiceMasterView();

        //        if (DS != null && DS.Tables.Count > 0)
        //        {
        //            if (DS.Tables[0].Rows.Count > 0)
        //            {
        //                SupplierInvoiceDetails.Id = DS.Tables[0].Rows[0]["Id"] != DBNull.Value ? (Guid)DS.Tables[0].Rows[0]["Id"] : Guid.Empty;
        //                SupplierInvoiceDetails.InvoiceNo = DS.Tables[0].Rows[0]["InvoiceNo"]?.ToString();
        //                SupplierInvoiceDetails.SiteId = DS.Tables[0].Rows[0]["SiteId"] != DBNull.Value ? (Guid)DS.Tables[0].Rows[0]["SiteId"] : Guid.Empty;
        //                SupplierInvoiceDetails.SiteName = DS.Tables[0].Rows[0]["SiteName"]?.ToString();
        //                SupplierInvoiceDetails.SupplierId = DS.Tables[0].Rows[0]["SupplierId"] != DBNull.Value ? (Guid)DS.Tables[0].Rows[0]["SupplierId"] : Guid.Empty;
        //                SupplierInvoiceDetails.SupplierName = DS.Tables[0].Rows[0]["SupplierName"]?.ToString();
        //                SupplierInvoiceDetails.Description = DS.Tables[0].Rows[0]["Description"]?.ToString();
        //                SupplierInvoiceDetails.SupplierArea = DS.Tables[0].Rows[0]["SupplierArea"]?.ToString();
        //                SupplierInvoiceDetails.SupplierAccountNo = DS.Tables[0].Rows[0]["SupplierAccountNo"]?.ToString();
        //                SupplierInvoiceDetails.SupplierBankName = DS.Tables[0].Rows[0]["SupplierBankName"]?.ToString();
        //                SupplierInvoiceDetails.SupplierBuildingName = DS.Tables[0].Rows[0]["SupplierBuildingName"]?.ToString();
        //                SupplierInvoiceDetails.SupplierCity = DS.Tables[0].Rows[0]["SupplierCity"]?.ToString();
        //                SupplierInvoiceDetails.SupplierGstNo = DS.Tables[0].Rows[0]["SupplierGstNo"]?.ToString();
        //                SupplierInvoiceDetails.SupplierIFSCCode = DS.Tables[0].Rows[0]["SupplierIFSCCode"]?.ToString();
        //                SupplierInvoiceDetails.SupplierEmail = DS.Tables[0].Rows[0]["SupplierEmail"]?.ToString();
        //                SupplierInvoiceDetails.SupplierState = DS.Tables[0].Rows[0]["SupplierState"]?.ToString();
        //                SupplierInvoiceDetails.SupplierPincode = DS.Tables[0].Rows[0]["SupplierPincode"]?.ToString();
        //                SupplierInvoiceDetails.CompanyId = DS.Tables[0].Rows[0]["CompanyId"] != DBNull.Value ? (Guid)DS.Tables[0].Rows[0]["CompanyId"] : Guid.Empty;
        //                SupplierInvoiceDetails.CompanyName = DS.Tables[0].Rows[0]["CompanyName"]?.ToString();
        //                SupplierInvoiceDetails.CompanyAddress = DS.Tables[0].Rows[0]["CompanyAddress"]?.ToString();
        //                SupplierInvoiceDetails.SupplierInvoiceNo = DS.Tables[0].Rows[0]["SupplierInvoiceNo"]?.ToString();
        //                SupplierInvoiceDetails.CompanyArea = DS.Tables[0].Rows[0]["CompanyArea"]?.ToString();
        //                SupplierInvoiceDetails.CompanyCityName = DS.Tables[0].Rows[0]["CompanyCityName"]?.ToString();
        //                SupplierInvoiceDetails.CompanyCountryName = DS.Tables[0].Rows[0]["CompanyCountryName"]?.ToString();
        //                SupplierInvoiceDetails.CompanyStateName = DS.Tables[0].Rows[0]["CompanyStateName"]?.ToString();
        //                SupplierInvoiceDetails.CompanyGstNo = DS.Tables[0].Rows[0]["CompanyGstNo"]?.ToString();
        //                SupplierInvoiceDetails.CompanyPincode = DS.Tables[0].Rows[0]["CompanyPincode"]?.ToString();
        //                SupplierInvoiceDetails.CompanyPanNo = DS.Tables[0].Rows[0]["CompanyPanNo"]?.ToString();
        //                SupplierInvoiceDetails.ShippingAddress = DS.Tables[0].Rows[0]["ShippingAddress"]?.ToString();
        //                SupplierInvoiceDetails.ShippingAddress = DS.Tables[0].Rows[0]["ShippingAddress"]?.ToString();
        //                SupplierInvoiceDetails.SupplierMobileNo = DS.Tables[0].Rows[0]["SupplierMobileNo"]?.ToString();
        //                SupplierInvoiceDetails.Date = DS.Tables[0].Rows[0]["Date"] != DBNull.Value ? (DateTime)DS.Tables[0].Rows[0]["Date"] : DateTime.MinValue;
        //                SupplierInvoiceDetails.TotalAmountInvoice = DS.Tables[0].Rows[0]["TotalAmountInvoice"] != DBNull.Value ? (decimal)DS.Tables[0].Rows[0]["TotalAmountInvoice"] : 0m;
        //                SupplierInvoiceDetails.TotalDiscount = DS.Tables[0].Rows[0]["TotalDiscount"] != DBNull.Value ? (decimal)DS.Tables[0].Rows[0]["TotalDiscount"] : 0m;
        //                SupplierInvoiceDetails.TotalGstamount = DS.Tables[0].Rows[0]["TotalGSTAmount"] != DBNull.Value ? (decimal)DS.Tables[0].Rows[0]["TotalGSTAmount"] : 0m;
        //                SupplierInvoiceDetails.PaymentStatus = DS.Tables[0].Rows[0]["PaymentStatus"]?.ToString();
        //                SupplierInvoiceDetails.IsPayOut = DS.Tables[0].Rows[0]["IsPayOut"] != DBNull.Value && (bool)DS.Tables[0].Rows[0]["IsPayOut"];
        //                SupplierInvoiceDetails.Roundoff = DS.Tables[0].Rows[0]["Roundoff"] != DBNull.Value ? (decimal)DS.Tables[0].Rows[0]["Roundoff"] : 0m;
        //                SupplierInvoiceDetails.ChallanNo = DS.Tables[0].Rows[0]["ChallanNo"]?.ToString();
        //                SupplierInvoiceDetails.Lrno = DS.Tables[0].Rows[0]["LRNo"]?.ToString();
        //                SupplierInvoiceDetails.VehicleNo = DS.Tables[0].Rows[0]["VehicleNo"]?.ToString();
        //                SupplierInvoiceDetails.DispatchBy = DS.Tables[0].Rows[0]["DispatchBy"]?.ToString();
        //                SupplierInvoiceDetails.PaymentTerms = DS.Tables[0].Rows[0]["PaymentTerms"]?.ToString();
        //                SupplierInvoiceDetails.ContactName = DS.Tables[0].Rows[0]["ContactName"]?.ToString();
        //                SupplierInvoiceDetails.ContactNumber = DS.Tables[0].Rows[0]["ContactNumber"]?.ToString();
        //                SupplierInvoiceDetails.SupplierFullAddress = DS.Tables[0].Rows[0]["SupplierFullAddress"]?.ToString();
        //                SupplierInvoiceDetails.CompanyFullAddress = DS.Tables[0].Rows[0]["CompanyFullAddress"]?.ToString();
        //                SupplierInvoiceDetails.CreatedOn = DS.Tables[0].Rows[0]["CreatedOn"] != DBNull.Value ? (DateTime)DS.Tables[0].Rows[0]["CreatedOn"] : DateTime.MinValue; ;
        //                SupplierInvoiceDetails.StateCode = DS.Tables[0].Rows[0]["StateCode"] != DBNull.Value ? (int)DS.Tables[0].Rows[0]["StateCode"] : 0;
        //            }

        //            SupplierInvoiceDetails.ItemList = new List<POItemDetailsModel>();

        //            foreach (DataRow row in DS.Tables[1].Rows)
        //            {
        //                var InvoiceDetails = new POItemDetailsModel
        //                {
        //                    ItemId = row["ItemId"] != DBNull.Value ? (Guid)row["ItemId"] : Guid.Empty,
        //                    ItemName = row["ItemName"]?.ToString(),
        //                    Hsncode = row["Hsncode"]?.ToString(),
        //                    Quantity = row["Quantity"] != DBNull.Value ? (decimal)row["Quantity"] : 0,
        //                    UnitType = row["UnitType"] != DBNull.Value ? (int)row["UnitType"] : 0,
        //                    UnitTypeName = row["UnitTypeName"]?.ToString(),
        //                    PricePerUnit = row["PricePerUnit"] != DBNull.Value ? (decimal)row["PricePerUnit"] : 0m,
        //                    Gstamount = row["Gstamount"] != DBNull.Value ? (decimal)row["Gstamount"] : 0m,
        //                    GstPercentage = row["GstPercentage"] != DBNull.Value ? (decimal)row["GstPercentage"] : 0m,
        //                    TotalAmount = row["TotalAmount"] != DBNull.Value ? (decimal)row["TotalAmount"] : 0m,
        //                    DiscountPer = row["DiscountPer"] != DBNull.Value ? (decimal)row["DiscountPer"] : 0m,
        //                    DiscountAmount = row["DiscountAmount"] != DBNull.Value ? (decimal)row["DiscountAmount"] : 0m,
        //                };

        //                SupplierInvoiceDetails.ItemList.Add(InvoiceDetails);
        //            }
        //        }
        //        return SupplierInvoiceDetails;
        //    }
        //    catch (Exception ex)
        //    {
        //        throw ex;
        //    }
        //}

        //public async Task<IEnumerable<SupplierInvoiceModel>> GetSupplierInvoiceList(string? searchText, string? searchBy, string? sortBy)
        //{
        //    try
        //    {
        //        string dbConnectionStr = Configuration.GetConnectionString("ACCDbconn");

        //        var parameters = new List<SqlParameter>
        //        {
        //    new SqlParameter("@SearchText", (object)searchText ?? DBNull.Value),
        //    new SqlParameter("@SearchBy", (object)searchBy ?? DBNull.Value),
        //    new SqlParameter("@SortBy", (object)sortBy ?? DBNull.Value)
        //        };

        //        var dataSet = DbHelper.GetDataSet("[spGetSupplierInvoiceList]", CommandType.StoredProcedure, parameters.ToArray(), dbConnectionStr);

        //        var supplierInvoiceList = new List<SupplierInvoiceModel>();

        //        foreach (DataRow row in dataSet.Tables[0].Rows)
        //        {
        //            var invoiceDetails = new SupplierInvoiceModel
        //            {
        //                Id = row["Id"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["Id"].ToString()),
        //                InvoiceNo = row["InvoiceNo"]?.ToString() ?? string.Empty,
        //                SiteId = row["SiteId"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["SiteId"].ToString()),
        //                SupplierId = row["SupplierId"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["SupplierId"].ToString()),
        //                CompanyId = row["CompanyId"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["CompanyId"].ToString()),
        //                TotalAmount = row["TotalAmount"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["TotalAmount"]),
        //                TotalDiscount = row["TotalDiscount"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["TotalDiscount"]),
        //                TotalGstamount = row["TotalGSTAmount"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["TotalGSTAmount"]),
        //                Roundoff = row["Roundoff"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["Roundoff"]),
        //                Description = row["Description"]?.ToString() ?? string.Empty,
        //                CompanyName = row["CompanyName"]?.ToString() ?? string.Empty,
        //                SiteName = row["SiteName"]?.ToString() ?? string.Empty,
        //                SupplierName = row["SupplierName"]?.ToString() ?? string.Empty,
        //                SupplierInvoiceNo = row["SupplierInvoiceNo"]?.ToString() ?? string.Empty,
        //                Date = row["Date"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(row["Date"]),
        //                CreatedOn = row["CreatedOn"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(row["CreatedOn"])
        //            };
        //            supplierInvoiceList.Add(invoiceDetails);
        //        }

        //        if (!string.IsNullOrEmpty(searchText))
        //        {
        //            searchText = searchText.ToLower();
        //            supplierInvoiceList = supplierInvoiceList.Where(u =>
        //                u.SiteName.ToLower().Contains(searchText) ||
        //                u.CompanyName.ToLower().Contains(searchText) ||
        //                u.SupplierName.ToLower().Contains(searchText) ||
        //                u.TotalAmount.ToString().Contains(searchText)
        //            ).ToList();
        //        }

        //        if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
        //        {
        //            searchText = searchText.ToLower();
        //            switch (searchBy.ToLower())
        //            {
        //                case "sitename":
        //                    supplierInvoiceList = supplierInvoiceList.Where(u => u.SiteName.ToLower().Contains(searchText)).ToList();
        //                    break;
        //                case "companyname":
        //                    supplierInvoiceList = supplierInvoiceList.Where(u => u.CompanyName.ToLower().Contains(searchText)).ToList();
        //                    break;
        //                default:
        //                    break;
        //            }
        //        }


        //        if (string.IsNullOrEmpty(sortBy))
        //        {
        //            supplierInvoiceList = supplierInvoiceList.OrderByDescending(u => u.CreatedOn).ToList();
        //        }
        //        else
        //        {
        //            bool ascending = sortBy.StartsWith("Ascending");
        //            string field = sortBy.Substring(ascending ? "Ascending".Length : "Descending".Length).Trim().ToLower();

        //            supplierInvoiceList = field switch
        //            {
        //                "companyname" => ascending
        //                    ? supplierInvoiceList.OrderBy(u => u.CompanyName).ToList()
        //                    : supplierInvoiceList.OrderByDescending(u => u.CompanyName).ToList(),
        //                "invoiceno" => ascending
        //                    ? supplierInvoiceList.OrderBy(u => u.InvoiceNo).ToList()
        //                    : supplierInvoiceList.OrderByDescending(u => u.InvoiceNo).ToList(),
        //                "createdon" => ascending
        //                    ? supplierInvoiceList.OrderBy(u => u.CreatedOn).ToList()
        //                    : supplierInvoiceList.OrderByDescending(u => u.CreatedOn).ToList(),
        //                _ => supplierInvoiceList
        //            };
        //        }

        //        return supplierInvoiceList;
        //    }
        //    catch (Exception ex)
        //    {
        //        throw ex;
        //    }
        //}

        public async Task<SupplierInvoiceList> GetSupplierInvoiceList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                var supplierDataQuery = from a in Context.SupplierInvoices
                                        join e in Context.SupplierInvoiceDetails on a.Id equals e.RefInvoiceId
                                        join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                                        join c in Context.Companies on a.CompanyId equals c.CompanyId
                                        join d in Context.Sites on a.SiteId equals d.SiteId
                                        join f in Context.ItemMasters on e.ItemId equals f.ItemId
                                        where a.InvoiceNo != "PayOut"
                                        select new
                                        {
                                            Invoice = new SupplierInvoiceModel
                                            {
                                                Id = a.Id,
                                                InvoiceNo = a.InvoiceNo,
                                                SiteId = a.SiteId,
                                                GroupName = a.SiteGroup,
                                                SupplierId = a.SupplierId,
                                                TotalAmount = a.TotalAmount,
                                                TotalDiscount = a.TotalDiscount,
                                                TotalGstamount = a.TotalGstamount,
                                                Description = a.Description,
                                                Tds = a.Tds,
                                                CompanyId = a.CompanyId,
                                                Date = a.Date,
                                                CompanyName = c.CompanyName,
                                                SiteName = d.SiteName,
                                                SupplierName = b.SupplierName,
                                                CreatedOn = a.CreatedOn,
                                                IsApproved = a.IsApproved,
                                                SupplierInvoiceNo = a.SupplierInvoiceNo,
                                            },
                                            Item = new SupplierInvoiceDetailsModel
                                            {
                                                RefInvoiceId = e.RefInvoiceId,
                                                ItemId = e.ItemId,
                                                ItemName = f.ItemName
                                            }
                                        };

                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    supplierDataQuery = supplierDataQuery.Where(u =>
                        u.Invoice.SiteName.ToLower().Contains(searchText) ||
                        u.Invoice.CompanyName.ToLower().Contains(searchText) ||
                        u.Invoice.SupplierName.ToLower().Contains(searchText) ||
                        u.Invoice.SupplierInvoiceNo.ToLower().Contains(searchText) ||
                        u.Invoice.TotalAmount.ToString().Contains(searchText) ||
                        u.Item.ItemName.ToLower().Contains(searchText)
                    );
                }

                if (!string.IsNullOrEmpty(sortBy))
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "date":
                            supplierDataQuery = sortOrder == "ascending"
                                ? supplierDataQuery.OrderBy(u => u.Invoice.Date)
                                : supplierDataQuery.OrderByDescending(u => u.Invoice.Date);
                            break;
                    }
                }
                else
                {
                    supplierDataQuery = supplierDataQuery.OrderBy(u => u.Invoice.Date);
                }

                var supplierData = await supplierDataQuery.ToListAsync();

                var groupedByRefInvoiceId = supplierData
                    .GroupBy(x => x.Item.RefInvoiceId)
                    .ToDictionary(
                        g => g.Key,
                        g => g.Select(x => x.Item).ToList()
                    );

                var invoicesGroupedById = supplierData
                    .GroupBy(x => x.Invoice.Id)
                    .Select(g => new
                    {
                        Invoice = g.First().Invoice,
                        Items = groupedByRefInvoiceId.ContainsKey(g.Key)
                            ? groupedByRefInvoiceId[g.Key]
                            : new List<SupplierInvoiceDetailsModel>()
                    })
                    .ToList();

                return new SupplierInvoiceList
                {
                    InvoiceList = invoicesGroupedById.Select(g => g.Invoice).ToList(),
                    InvoiceItemList = invoicesGroupedById.ToDictionary(g => g.Invoice.Id, g => g.Items.AsEnumerable())
                };
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> UpdateSupplierInvoice(SupplierInvoiceMasterView SupplierInvoiceDetail)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var supplierInvoice = new SupplierInvoice()
                {
                    Id = SupplierInvoiceDetail.Id,
                    InvoiceNo = SupplierInvoiceDetail.InvoiceNo,
                    InvoiceType = SupplierInvoiceDetail.InvoiceType,
                    SiteId = SupplierInvoiceDetail.SiteId,
                    SupplierId = SupplierInvoiceDetail.SupplierId,
                    CompanyId = SupplierInvoiceDetail.CompanyId,
                    SupplierInvoiceNo = SupplierInvoiceDetail.SupplierInvoiceNo,
                    Description = SupplierInvoiceDetail.Description,
                    TotalDiscount = SupplierInvoiceDetail.TotalDiscount,
                    TotalGstamount = SupplierInvoiceDetail.TotalGstamount,
                    TotalAmount = SupplierInvoiceDetail.TotalAmountInvoice,
                    PaymentStatus = SupplierInvoiceDetail.PaymentStatus,
                    Tds = SupplierInvoiceDetail.Tds,
                    ShippingAddress = SupplierInvoiceDetail.ShippingAddress,
                    ChallanNo = SupplierInvoiceDetail.ChallanNo,
                    Lrno = SupplierInvoiceDetail.Lrno,
                    VehicleNo = SupplierInvoiceDetail.VehicleNo,
                    DispatchBy = SupplierInvoiceDetail.DispatchBy,
                    PaymentTerms = SupplierInvoiceDetail.PaymentTerms,
                    IsPayOut = SupplierInvoiceDetail.IsPayOut,
                    Date = SupplierInvoiceDetail.Date,
                    UpdatedOn = DateTime.Now,
                    UpdatedBy = SupplierInvoiceDetail.UpdatedBy,
                    CreatedOn = SupplierInvoiceDetail.CreatedOn,
                    DiscountRoundoff = SupplierInvoiceDetail.DiscountRoundoff,
                    SiteGroup = SupplierInvoiceDetail.SiteGroup,
                    IsApproved = SupplierInvoiceDetail.IsApproved,
                    Poid = SupplierInvoiceDetail.Poid,
                    GroupAddress = SupplierInvoiceDetail.GroupAddress,
                };
                Context.SupplierInvoices.Update(supplierInvoice);

                var existingItems = Context.SupplierInvoiceDetails
             .Where(e => e.RefInvoiceId == supplierInvoice.Id)
             .ToList();

                Context.SupplierInvoiceDetails.RemoveRange(existingItems);
                await Context.SaveChangesAsync();

                foreach (var item in SupplierInvoiceDetail.ItemList)
                {
                    var newSupplierInvoice = new SupplierInvoiceDetail()
                    {
                        RefInvoiceId = supplierInvoice.Id,
                        ItemId = item.ItemId,
                        ItemName = item.ItemName,
                        ItemDescription = item.ItemDescription,
                        UnitTypeId = item.UnitType,
                        Quantity = item.Quantity,
                        Price = item.PricePerUnit,
                        DiscountAmount = item.DiscountAmount,
                        DiscountPer = item.DiscountPer,
                        Gst = item.Gstamount,
                        Gstper = item.GstPercentage,
                        TotalAmount = item.TotalAmount,
                        Date = supplierInvoice.Date,
                        CreatedOn = DateTime.Now,
                    };

                    Context.SupplierInvoiceDetails.Add(newSupplierInvoice);
                }

                await Context.SaveChangesAsync();

                response.code = (int)HttpStatusCode.OK;
                response.message = "Invoice updated successfully.";
                response.data = new
                {
                    InvoiceId = supplierInvoice.Id,
                    NewItemsCount = SupplierInvoiceDetail.ItemList.Count,
                };
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error updating invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> InsertMultipleSupplierItemDetails(SupplierInvoiceMasterView SupplierItemDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                bool PayOut;
                if (SupplierItemDetails.PaymentStatus == "Unpaid")
                {
                    PayOut = false;
                }
                else
                {
                    PayOut = true;
                }

                var supplierInvoice = new SupplierInvoice()
                {
                    Id = Guid.NewGuid(),
                    InvoiceNo = SupplierItemDetails.InvoiceNo,
                    InvoiceType = SupplierItemDetails.InvoiceType,
                    SiteId = SupplierItemDetails.SiteId,
                    SupplierId = SupplierItemDetails.SupplierId,
                    CompanyId = SupplierItemDetails.CompanyId,
                    SupplierInvoiceNo = SupplierItemDetails.SupplierInvoiceNo,
                    Description = SupplierItemDetails.Description,
                    TotalDiscount = SupplierItemDetails.TotalDiscount,
                    TotalGstamount = SupplierItemDetails.TotalGstamount,
                    TotalAmount = SupplierItemDetails.TotalAmountInvoice,
                    PaymentStatus = SupplierItemDetails.PaymentStatus,
                    Tds = SupplierItemDetails.Tds,
                    ChallanNo = SupplierItemDetails.ChallanNo,
                    Lrno = SupplierItemDetails.Lrno,
                    VehicleNo = SupplierItemDetails.VehicleNo,
                    DispatchBy = SupplierItemDetails.DispatchBy,
                    PaymentTerms = SupplierItemDetails.PaymentTerms,
                    ShippingAddress = SupplierItemDetails.ShippingAddress,
                    DiscountRoundoff = SupplierItemDetails.DiscountRoundoff,
                    IsPayOut = PayOut,
                    IsApproved = SupplierItemDetails.IsApproved,
                    Date = SupplierItemDetails.Date,
                    CreatedBy = SupplierItemDetails.CreatedBy,
                    CreatedOn = DateTime.Now,
                    SiteGroup = SupplierItemDetails.SiteGroup,
                    Poid = SupplierItemDetails.Poid,
                    GroupAddress = SupplierItemDetails.GroupAddress,
                };
                Context.SupplierInvoices.Add(supplierInvoice);

                foreach (var item in SupplierItemDetails.ItemList)
                {
                    var supplierInvoiceDetail = new SupplierInvoiceDetail()
                    {
                        RefInvoiceId = supplierInvoice.Id,
                        ItemId = item.ItemId,
                        ItemName = item.ItemName,
                        ItemDescription = item.ItemDescription,
                        UnitTypeId = item.UnitType,
                        Quantity = item.Quantity,
                        Price = item.PricePerUnit,
                        DiscountAmount = item.DiscountAmount,
                        DiscountPer = item.DiscountPer,
                        Gst = item.Gstamount,
                        Gstper = item.GstPercentage,
                        TotalAmount = item.TotalAmount,
                        CreatedBy = SupplierItemDetails.CreatedBy,
                        CreatedOn = DateTime.Now,
                        Date = supplierInvoice.Date,
                    };
                    Context.SupplierInvoiceDetails.Add(supplierInvoiceDetail);
                }

                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "Invoice inserted successfully.";
                response.data = supplierInvoice.Id;
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error creating invoice: " + ex.Message;
            }
            return response;
        }

        public string CheckSuppliersInvoiceNo(Guid? CompanyId)
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
                    var lastInvoice = Context.SupplierInvoices
                        .Where(a => a.InvoiceNo != "PayOut" && a.InvoiceNo != "Opening Balance" && a.CompanyId == CompanyId)
                        .OrderByDescending(e => e.CreatedOn)
                        .FirstOrDefault();

                    var currentDate = DateTime.Now;
                    int currentYear = FinancialYear.CurrentAsProduced(currentDate).EndYear;
                    int lastYear = currentYear - 1;

                    string supplierInvoiceId;
                    string trimmedInvoicePef = CompanyDetails.InvoicePef.Trim();
                    if (lastInvoice == null)
                    {
                        supplierInvoiceId = $"{trimmedInvoicePef}/{(lastYear % 100):D2}-{(currentYear % 100):D2}/001";
                    }
                    else
                    {
                        string lastInvoiceNumber = lastInvoice.InvoiceNo.Substring(lastInvoice.InvoiceNo.LastIndexOf('/') + 1);
                        Match match = Regex.Match(lastInvoiceNumber, @"\d+$");
                        if (match.Success)
                        {
                            int lastInvoiceNumberValue = int.Parse(match.Value);
                            int newInvoiceNumberValue = lastInvoiceNumberValue + 1;
                            supplierInvoiceId = $"{trimmedInvoicePef}/{(lastYear % 100):D2}-{(currentYear % 100):D2}/{newInvoiceNumberValue:D3}";
                        }
                        else
                        {
                            throw new Exception("Supplier invoice id does not have the expected format.");
                        }
                    }
                    return supplierInvoiceId;
                }
            }
            catch (Exception ex)
            {
                string error;
                error = "Error generating supplier invoice number.";
                return error;
            }
        }
        public async Task<IEnumerable<SupplierInvoiceModel>> GetSupplierInvoiceDetailsById(Guid SupplierId)
        {
            try
            {
                var supplierInvoices = (from a in Context.SupplierInvoices
                                        join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                                        join c in Context.Companies on a.CompanyId equals c.CompanyId
                                        where a.SupplierId == SupplierId
                                        select new SupplierInvoiceModel
                                        {
                                            Id = a.Id,
                                            InvoiceNo = a.InvoiceNo,
                                            SupplierId = a.SupplierId,
                                            SupplierName = b.SupplierName,
                                            CompanyId = a.CompanyId,
                                            CompanyName = c.CompanyName,
                                            Date = DateTime.Now,
                                            TotalAmount = a.TotalAmount,
                                            TotalDiscount = a.TotalDiscount,
                                            TotalGstamount = a.TotalGstamount,
                                            Description = a.Description,
                                            Tds = a.Tds,
                                            IsPayOut = a.IsPayOut,
                                            SupplierInvoiceNo = a.SupplierInvoiceNo,
                                            PaymentStatus = a.PaymentStatus,
                                            DiscountRoundoff = a.DiscountRoundoff,
                                            IsApproved = a.IsApproved,
                                        });
                return (supplierInvoices);
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        //public async Task<IEnumerable<SupplierInvoiceModel>> GetSupplierInvoiceDetailsReport(InvoiceReportModel invoiceReport)
        //{
        //    try
        //    {
        //        List<SqlParameter> parameters = new List<SqlParameter>
        //{
        //    new SqlParameter("@CompanyId", invoiceReport.CompanyId ?? (object)DBNull.Value),
        //    new SqlParameter("@SiteId", invoiceReport.SiteId ?? (object)DBNull.Value),
        //    new SqlParameter("@SupplierId", invoiceReport.SupplierId ?? (object)DBNull.Value),
        //    new SqlParameter("@filterType", invoiceReport.filterType ?? (object)DBNull.Value),
        //    new SqlParameter("@StartDate", invoiceReport.startDate ?? (object)DBNull.Value),
        //    new SqlParameter("@EndDate", invoiceReport.endDate ?? (object)DBNull.Value)
        //};

        //        string dbConnectionStr = Configuration.GetConnectionString("ACCDbconn");
        //        var dataSet = DbHelper.GetDataSet("GetSupplierInvoiceDetailsReport", CommandType.StoredProcedure, parameters.ToArray(), dbConnectionStr);

        //        List<SupplierInvoiceModel> SupplierInvoiceList = new List<SupplierInvoiceModel>();

        //        foreach (DataRow row in dataSet.Tables[0].Rows)
        //        {
        //            var InvoiceDetails = new SupplierInvoiceModel
        //            {
        //                Id = row["Id"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["Id"].ToString()),
        //                InvoiceNo = row["InvoiceNo"]?.ToString() ?? string.Empty,
        //                SiteId = row["SiteId"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["SiteId"].ToString()),
        //                SupplierId = row["SupplierId"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["SupplierId"].ToString()),
        //                CompanyId = row["CompanyId"] == DBNull.Value ? Guid.Empty : Guid.Parse(row["CompanyId"].ToString()),
        //                TotalAmount = row["TotalAmount"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["TotalAmount"]),
        //                TotalDiscount = row["TotalDiscount"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["TotalDiscount"]),
        //                TotalGstamount = row["TotalGSTAmount"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["TotalGSTAmount"]),
        //                Roundoff = row["Roundoff"] == DBNull.Value ? 0.0m : Convert.ToDecimal(row["Roundoff"]),
        //                Description = row["Description"]?.ToString() ?? string.Empty,
        //                CompanyName = row["CompanyName"]?.ToString() ?? string.Empty,
        //                SupplierName = row["SupplierName"]?.ToString() ?? string.Empty,
        //                PaymentStatus = row["PaymentStatus"]?.ToString() ?? string.Empty,
        //                IsPayOut = row["IsPayOut"] != DBNull.Value && (bool)row["IsPayOut"],
        //                SupplierInvoiceNo = row["SupplierInvoiceNo"]?.ToString() ?? string.Empty,
        //                Date = row["Date"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(row["Date"]),
        //                CreatedOn = row["CreatedOn"] == DBNull.Value ? DateTime.MinValue : Convert.ToDateTime(row["CreatedOn"]),
        //            };

        //            SupplierInvoiceList.Add(InvoiceDetails);
        //        }

        //        return SupplierInvoiceList;
        //    }
        //    catch (Exception ex)
        //    {
        //        throw ex;
        //    }
        //}

        public async Task<jsonData> GetSupplierInvoiceDetailsReport(DataTableRequstModel invoiceReport)
        {
            try
            {
                var query = from s in Context.SupplierInvoices
                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                            join d in Context.Sites on s.SiteId equals d.SiteId into siteGroup
                            from d in siteGroup.DefaultIfEmpty()
                            select new
                            {
                                s,
                                SupplierName = b.SupplierName,
                                InvoiceNo = s.InvoiceNo,
                                Group = s.SiteGroup,
                                TotalAmount = s.TotalAmount,
                                CompanyName = c.CompanyName,
                                SiteName = d != null ? d.SiteName : null,
                                Date = s.Date
                            };

                if (invoiceReport.CompanyId.HasValue)
                {
                    query = query.Where(s => s.s.CompanyId == invoiceReport.CompanyId.Value);
                }
                if (invoiceReport.SiteId.HasValue)
                {
                    query = query.Where(s => s.s.SiteId == invoiceReport.SiteId.Value);
                }
                if (invoiceReport.SupplierId.HasValue)
                {
                    query = query.Where(s => s.s.SupplierId == invoiceReport.SupplierId.Value);
                }
                if (!string.IsNullOrEmpty(invoiceReport.GroupName))
                {
                    query = query.Where(s => s.s.SiteGroup == invoiceReport.GroupName);
                }

                if (!string.IsNullOrEmpty(invoiceReport.sortColumn) && !string.IsNullOrEmpty(invoiceReport.sortColumnDir))
                {
                    // Removed: `var queryType = query.FirstOrDefault().GetType();`
                    // It was never read, cost a full round-trip to the database on
                    // every sorted report, and threw NullReferenceException when the
                    // report matched no rows. See 05-Performance-Analysis.md, P5.
                    switch (invoiceReport.sortColumn.ToLower())
                    {
                        case "suppliername":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.SupplierName)
                                : query.OrderByDescending(s => s.SupplierName);
                            break;
                        case "companyname":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.CompanyName)
                                : query.OrderByDescending(s => s.CompanyName);
                            break;
                        case "invoiceno":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.InvoiceNo)
                                : query.OrderByDescending(s => s.InvoiceNo);
                            break;
                        case "groupname":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.Group)
                                : query.OrderByDescending(s => s.Group);
                            break;
                        case "sitename":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.SiteName)
                                : query.OrderByDescending(s => s.SiteName);
                            break;
                        case "credit":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.TotalAmount)
                                : query.OrderByDescending(s => s.TotalAmount);
                            break;
                        case "debit":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.TotalAmount)
                                : query.OrderByDescending(s => s.TotalAmount);
                            break;
                        case "date":
                            query = invoiceReport.sortColumnDir == "asc"
                                ? query.OrderBy(s => s.Date)
                                : query.OrderByDescending(s => s.Date);
                            break;
                        case "totalamount":
                            query = invoiceReport.sortColumnDir == "asc"
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

                if (!string.IsNullOrEmpty(invoiceReport.filterType))
                {
                    if (invoiceReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (invoiceReport.filterType == "currentYear")
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
                    else if (invoiceReport.filterType == "betweenYear" && !string.IsNullOrEmpty(invoiceReport.SelectedYear))
                    {

                        var years = invoiceReport.SelectedYear.Split('-');

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

                if (invoiceReport.startDate.HasValue)
                {
                    query = query.Where(s => s.s.Date >= invoiceReport.startDate.Value);
                }
                if (invoiceReport.endDate.HasValue)
                {
                    query = query.Where(s => s.s.Date <= invoiceReport.endDate.Value);
                }
                if (!string.IsNullOrEmpty(invoiceReport.searchValue))
                {
                    query = query.Where(s => s.SupplierName.Contains(invoiceReport.searchValue) ||
                                             s.InvoiceNo.Contains(invoiceReport.searchValue) ||
                                             s.CompanyName.Contains(invoiceReport.searchValue));
                }

                var totalRecords = await query.CountAsync();


                var allData = await query
           .Select(s => new SupplierInvoiceModel
           {
               Id = s.s.Id,
               InvoiceNo = s.s.InvoiceNo,
               SiteId = s.s.SiteId,
               SupplierId = s.s.SupplierId,
               CompanyId = s.s.CompanyId,
               TotalAmount = s.s.TotalAmount,
               GroupName = s.s.SiteGroup,
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
                    .Where(i => i.InvoiceNo != "PayOut" &&
                        i.InvoiceType != "Purchase Return" &&
                        i.InvoiceType != "Credit Note")
                        .Sum(i => i.TotalAmount);

                var TotalDebit = allData
                    .Where(i => i.InvoiceNo == "PayOut" ||
                        i.InvoiceType == "Purchase Return" ||
                        i.InvoiceType == "Credit Note")
                        .Sum(i => i.TotalAmount);

                var jsonData = new jsonData
                {
                    draw = invoiceReport.draw,
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

        public async Task<ApiResponseModel> DeletePayoutDetails(Guid InvoiceId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var payoutdetails = Context.SupplierInvoices.Where(a => a.Id == InvoiceId).FirstOrDefault();

                if (payoutdetails != null)
                {
                    Context.SupplierInvoices.Remove(payoutdetails);
                    Context.SaveChanges();
                    response.code = 200;
                    response.message = "payout invoice is successfully deleted.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in deleting payout invoice.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error in deleting invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<SupplierInvoiceModel> GetPayoutDetailsbyId(Guid InvoiceId)
        {
            SupplierInvoiceModel payoutdetails = new SupplierInvoiceModel();
            try
            {
                payoutdetails = (from a in Context.SupplierInvoices.Where(x => x.Id == InvoiceId)
                                 join b in Context.Sites on a.SiteId equals b.SiteId into siteGroup
                                 from b in siteGroup.DefaultIfEmpty()
                                 join c in Context.SupplierMasters on a.SupplierId equals c.SupplierId
                                 join d in Context.Companies on a.CompanyId equals d.CompanyId
                                 select new SupplierInvoiceModel
                                 {
                                     Id = a.Id,
                                     InvoiceNo = a.InvoiceNo,
                                     SiteId = a.SiteId,
                                     SupplierId = a.SupplierId,
                                     CompanyId = a.CompanyId,
                                     SiteName = b != null ? b.SiteName : null,
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
                return payoutdetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<ApiResponseModel> UpdatePayoutDetails(SupplierInvoiceModel updatepayoutDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var payoutdetails = Context.SupplierInvoices.Where(a => a.Id == updatepayoutDetails.Id).FirstOrDefault();

                if (payoutdetails != null)
                {
                    payoutdetails.Id = updatepayoutDetails.Id;
                    payoutdetails.SiteId = updatepayoutDetails.SiteId;
                    payoutdetails.SupplierId = updatepayoutDetails.SupplierId;
                    payoutdetails.CompanyId = updatepayoutDetails.CompanyId;
                    payoutdetails.TotalAmount = updatepayoutDetails.TotalAmount;
                    payoutdetails.PaymentStatus = updatepayoutDetails.PaymentStatus;
                    payoutdetails.Date = updatepayoutDetails.Date;
                    payoutdetails.Description = updatepayoutDetails.Description;
                    payoutdetails.UpdatedBy = updatepayoutDetails.UpdatedBy;
                    payoutdetails.UpdatedOn = DateTime.Now;


                    Context.SupplierInvoices.Update(payoutdetails);
                    Context.SaveChanges();
                    response.code = 200;
                    response.message = "payout invoice is updated successfully.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in updating payout invoice.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error in updating invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> InvoiceIsApproved(InvoiceIsApprovedMasterModel InvoiceIdList)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var approvalDict = InvoiceIdList.InvoiceList.ToDictionary(x => x.Id, x => x.IsApproved);
                var requestedIds = approvalDict.Keys.ToList();

                // Load ONLY the invoices being approved. This previously read every
                // SupplierInvoice in the table and called Update() on all of them, so
                // approving a single invoice issued an UPDATE against every row — a
                // full-table rewrite that also clobbered any concurrent edit.
                // See Migration-Assessment/05-Performance-Analysis.md, finding P2.
                var allInvoices = await Context.SupplierInvoices
                    .Where(x => requestedIds.Contains(x.Id))
                    .ToListAsync();

                foreach (var invoice in allInvoices)
                {
                    if (approvalDict.TryGetValue(invoice.Id, out var isApproved))
                    {
                        invoice.IsApproved = isApproved;
                    }

                    Context.SupplierInvoices.Update(invoice);
                }
                await Context.SaveChangesAsync();

                response.code = 200;
                response.message = "Invoice approved/unapproved successfully.";
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error approving the invoice: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> CheckOpeningBalance(Guid SupplierId, Guid CompanyId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var existingOB = Context.SupplierInvoices.FirstOrDefault(x => x.SupplierId == SupplierId && x.CompanyId == CompanyId && x.InvoiceNo == "Opening Balance");
                if (existingOB != null)
                {
                    response.code = 400;
                    response.message = "Already had opening balance.";
                }
                else
                {
                    response.code = 200;
                    response.message = "No record of Opening balance found.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error checking the opening balance.";
            }
            return response;
        }

        public async Task<InvoiceTotalAmount> GetInvoiceDetailsPdfReport(InvoiceReportModel invoiceReport)
        {
            try
            {
                var query = from s in Context.SupplierInvoices
                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                            join d in Context.Sites on s.SiteId equals d.SiteId into siteGroup
                            from d in siteGroup.DefaultIfEmpty()
                            select new
                            {
                                s,
                                SupplierName = b.SupplierName,
                                InvoiceNo = s.InvoiceNo,
                                Group = s.SiteGroup,
                                CompanyName = c.CompanyName,
                                SiteName = d != null ? d.SiteName : null,
                                Date = s.Date
                            };

                if (invoiceReport.CompanyId.HasValue)
                {
                    query = query.Where(s => s.s.CompanyId == invoiceReport.CompanyId.Value).OrderBy(s => s.s.CreatedOn);
                }
                if (invoiceReport.SiteId.HasValue)
                {
                    query = query.Where(s => s.s.SiteId == invoiceReport.SiteId.Value).OrderBy(s => s.s.CreatedOn);
                }
                if (invoiceReport.SupplierId.HasValue)
                {
                    query = query.Where(s => s.s.SupplierId == invoiceReport.SupplierId.Value).OrderBy(s => s.s.CreatedOn);
                }
                if (!string.IsNullOrEmpty(invoiceReport.GroupName))
                {
                    query = query.Where(s => s.s.SiteGroup == invoiceReport.GroupName).OrderBy(s => s.s.CreatedOn);
                }

                if (!string.IsNullOrEmpty(invoiceReport.filterType))
                {
                    if (invoiceReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startDate && s.s.Date <= endDate).OrderBy(s => s.s.CreatedOn);
                    }
                    else if (invoiceReport.filterType == "currentYear")
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
                    else if (invoiceReport.filterType == "betweenYear" && !string.IsNullOrEmpty(invoiceReport.SelectedYear))
                    {
                        var years = invoiceReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);

                        query = query.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear).OrderBy(s => s.s.CreatedOn);
                    }
                    else if (invoiceReport.filterType == "betweenDate" && invoiceReport.startDate.HasValue && invoiceReport.endDate.HasValue)
                    {
                        var startDate = invoiceReport.startDate.Value.Date;
                        var endDate = invoiceReport.endDate.Value.Date;

                        query = query.Where(s => s.s.Date >= startDate && s.s.Date <= endDate).OrderBy(s => s.s.CreatedOn);
                    }
                }

                if (invoiceReport.endDate.HasValue)
                {
                    query = query.Where(s => s.s.Date <= invoiceReport.endDate.Value).OrderBy(s => s.s.CreatedOn);
                }

                var totalRecords = await query.CountAsync();

                var SupplierInvoiceList = await query.Select(s => new SupplierInvoiceModel
                {
                    Id = s.s.Id,
                    InvoiceNo = s.s.InvoiceNo,
                    SiteId = s.s.SiteId,
                    SupplierId = s.s.SupplierId,
                    CompanyId = s.s.CompanyId,
                    TotalAmount = s.s.TotalAmount,
                    GroupName = s.s.SiteGroup,
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
                    .OrderBy(s => s.Date)
                .ToListAsync();

                var CreditTotalAmount = SupplierInvoiceList
                    .Where(i => i.InvoiceNo != "PayOut" &&
                        i.InvoiceType != "Purchase Return" &&
                        i.InvoiceType != "Credit Note")
                        .Sum(i => i.TotalAmount);

                var DebitTotalAmount = SupplierInvoiceList
                    .Where(i => i.InvoiceNo == "PayOut" ||
                        i.InvoiceType == "Purchase Return" ||
                        i.InvoiceType == "Credit Note")
                        .Sum(i => i.TotalAmount);

                var PendingTotalAmount = CreditTotalAmount - DebitTotalAmount;

                var PayOutDetails = new InvoiceTotalAmount
                {
                    InvoiceList = SupplierInvoiceList,
                    TotalPending = PendingTotalAmount,
                    TotalCreadit = CreditTotalAmount,
                    TotalPurchase = DebitTotalAmount
                };

                return PayOutDetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<InvoiceTotalAmount> GetPayoutInvoiceDetailsPdfReport(InvoiceReportModel PayOutReport)
        {
            try
            {
                var supplierInvoicesQuery = from s in Context.SupplierInvoices
                                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                                            join d in Context.Sites on s.SiteId equals d.SiteId into siteGroup
                                            from d in siteGroup.DefaultIfEmpty()
                                            select new
                                            {
                                                s,
                                                SupplierName = b.SupplierName,
                                                CompanyName = c.CompanyName,
                                                SiteName = d != null ? d.SiteName : null,
                                                Group = s.SiteGroup,
                                                Date = s.Date,
                                                TotalAmount = s.TotalAmount,

                                            };

                if (PayOutReport.CompanyId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.CompanyId == PayOutReport.CompanyId.Value);
                }

                if (PayOutReport.SiteId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SiteId == PayOutReport.SiteId.Value);
                }

                if (PayOutReport.SupplierId.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SupplierId == PayOutReport.SupplierId.Value);
                }

                if (!string.IsNullOrEmpty(PayOutReport.GroupName))
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.SiteGroup == PayOutReport.GroupName);
                }

                if (!string.IsNullOrEmpty(PayOutReport.filterType))
                {
                    if (PayOutReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (PayOutReport.filterType == "tillMonth")
                    {
                        var tillMonth = PayOutReport.TillMonth.Value;
                        int year = tillMonth.Year;
                        int month = tillMonth.Month;

                        var startDate = new DateTime(year, 1, 1);
                        var endDate = new DateTime(year, month, 1).AddDays(-1);

                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (PayOutReport.filterType == "currentYear")
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
                    else if (PayOutReport.filterType == "betweenYear" && !string.IsNullOrEmpty(PayOutReport.SelectedYear))
                    {
                        var years = PayOutReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = years[1].Length == 2
                            ? int.Parse(years[1]) + (startYear / 100) * 100
                            : int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);
                        supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear);
                    }
                }

                if (PayOutReport.startDate.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date >= PayOutReport.startDate.Value);
                }

                if (PayOutReport.endDate.HasValue)
                {
                    supplierInvoicesQuery = supplierInvoicesQuery.Where(s => s.s.Date <= PayOutReport.endDate.Value);
                }

                var groupedBySite = await supplierInvoicesQuery
.GroupBy(g => g.s.SiteId)
.Select(siteGroup => new
{
    SiteId = siteGroup.Key,
    SupplierInvoices = siteGroup.GroupBy(g => g.s.SupplierId).Select(supplierGroup => new SupplierInvoiceModel
    {
        Id = supplierGroup.FirstOrDefault().s.Id,
        InvoiceNo = supplierGroup.FirstOrDefault().s.InvoiceNo,
        SiteId = supplierGroup.FirstOrDefault().s.SiteId,
        SupplierId = supplierGroup.Key,
        CompanyId = supplierGroup.FirstOrDefault().s.CompanyId,
        PayOutTotalAmount = supplierGroup.Where(x => x.s.InvoiceNo == "PayOut" || x.s.InvoiceType == "Purchase Return" || x.s.InvoiceType == "Credit Note").Sum(x => x.s.TotalAmount),
        NonPayOutTotalAmount = supplierGroup.Where(x => x.s.InvoiceNo != "PayOut" && x.s.InvoiceType != "Purchase Return" && x.s.InvoiceType != "Credit Note").Sum(x => x.s.TotalAmount),
        NetAmount = supplierGroup.Sum(x => x.s.InvoiceNo != "PayOut" ? x.s.TotalAmount : -x.s.TotalAmount),
        GroupName = supplierGroup.FirstOrDefault().s.SiteGroup,
        Description = string.Join(", ", supplierGroup.Select(x => x.s.Description)),
        CompanyName = supplierGroup.FirstOrDefault().CompanyName,
        SupplierName = supplierGroup.FirstOrDefault().SupplierName,
        PaymentStatus = supplierGroup.FirstOrDefault().s.PaymentStatus,
        IsPayOut = supplierGroup.FirstOrDefault().s.IsPayOut,
        SupplierInvoiceNo = supplierGroup.FirstOrDefault().s.SupplierInvoiceNo,
        Date = supplierGroup.FirstOrDefault().s.Date,
        CreatedOn = supplierGroup.FirstOrDefault().s.CreatedOn,
        SiteName = supplierGroup.FirstOrDefault().SiteName
    }).ToList()
}).ToListAsync();

                var totalCredit = groupedBySite.Sum(site => site.SupplierInvoices.Sum(i => i.NonPayOutTotalAmount));
                var totalDebit = groupedBySite.Sum(site => site.SupplierInvoices.Sum(i => i.PayOutTotalAmount));
                var totalPending = totalCredit - totalDebit;

                var PayOutDetails = new InvoiceTotalAmount
                {
                    InvoiceList = groupedBySite.SelectMany(site => site.SupplierInvoices).Where(inv => inv.NetAmount != 0).ToList(),
                    TotalPending = totalPending ?? 0m,
                    TotalCreadit = totalCredit ?? 0m,
                    TotalPurchase = totalDebit ?? 0m
                };

                return PayOutDetails;

            }
            catch (Exception ex)
            {
                throw new Exception("An error occurred while fetching invoice details.", ex);
            }
        }

        public async Task<bool> CheckSupplierInvoiceNo(SupplierInvoiceModel InvoiceData)
        {
            try
            {
                bool supplierInvoiceExists = await Context.SupplierInvoices
                    .AnyAsync(x => x.CompanyId == InvoiceData.CompanyId &&
                          x.SupplierInvoiceNo == InvoiceData.SupplierInvoiceNo &&
                          x.SupplierId == InvoiceData.SupplierId);
                return supplierInvoiceExists;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<List<SupplierInvoiceMasterView>> InvoiceDetailsExportToPdf(Guid? SiteId)
        {
            try
            {
                var supplierInvoiceData = await (from a in Context.SupplierInvoices
                                                 join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                                                 join c in Context.Companies on a.CompanyId equals c.CompanyId
                                                 join d in Context.Sites on a.SiteId equals d.SiteId
                                                 where a.InvoiceNo != "PayOut" && a.IsApproved == true && a.SiteId == SiteId
                                                 select new SupplierInvoiceMasterView
                                                 {
                                                     Id = a.Id,
                                                     InvoiceNo = a.InvoiceNo,
                                                     SiteId = a.SiteId,
                                                     SupplierId = a.SupplierId,
                                                     TotalAmount = a.TotalAmount,
                                                     TotalDiscount = a.TotalDiscount,
                                                     TotalGstamount = a.TotalGstamount,
                                                     CompanyId = a.CompanyId,
                                                     Date = a.Date,
                                                     CompanyName = c.CompanyName,
                                                     SiteName = d.SiteName,
                                                     SiteGroup = a.SiteGroup,
                                                     SupplierName = b.SupplierName,
                                                     SupplierInvoiceNo = a.SupplierInvoiceNo,
                                                 }).OrderBy(e => e.Date).ToListAsync();

                foreach (var invoice in supplierInvoiceData)
                {
                    var itemList = await (from a in Context.SupplierInvoiceDetails
                                          join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId into unitJoin
                                          from b in unitJoin.DefaultIfEmpty()
                                          join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                          where a.RefInvoiceId == invoice.Id
                                          select new POItemDetailsModel
                                          {
                                              ItemId = a.ItemId,
                                              ItemName = i.ItemName,
                                              UnitType = a.UnitTypeId,
                                              UnitTypeName = b != null ? b.UnitName : null,
                                              Quantity = a.Quantity,
                                              Gstamount = a.Gst,
                                              TotalAmount = a.TotalAmount,
                                              PricePerUnit = a.Price,
                                          }).ToListAsync();
                    invoice.ItemList = itemList;
                }

                return supplierInvoiceData;
            }
            catch (Exception ex)
            {
                throw new Exception("An error occurred while fetching invoice details.", ex);
            }
        }
        public async Task<InvoiceTotalAmount> GetInvoiceDetailsBySupplierExcelReport(InvoiceReportModel invoiceReport)
        {
            try
            {
                var query = from s in Context.SupplierInvoices
                            join b in Context.SupplierMasters on s.SupplierId equals b.SupplierId
                            join c in Context.Companies on s.CompanyId equals c.CompanyId
                            join d in Context.Sites on s.SiteId equals d.SiteId into siteGroup
                            from d in siteGroup.DefaultIfEmpty()
                            select new
                            {
                                s,
                                SupplierName = b.SupplierName,
                                InvoiceNo = s.InvoiceNo,
                                Group = s.SiteGroup,
                                CompanyName = c.CompanyName,
                                SiteName = d != null ? d.SiteName : null,
                                Date = s.Date
                            };

                if (invoiceReport.CompanyId.HasValue)
                {
                    query = query.Where(s => s.s.CompanyId == invoiceReport.CompanyId.Value);
                }
                if (invoiceReport.SiteId.HasValue)
                {
                    query = query.Where(s => s.s.SiteId == invoiceReport.SiteId.Value);
                }
                if (invoiceReport.SupplierId.HasValue)
                {
                    query = query.Where(s => s.s.SupplierId == invoiceReport.SupplierId.Value);
                }
                if (!string.IsNullOrEmpty(invoiceReport.GroupName))
                {
                    query = query.Where(s => s.s.SiteGroup == invoiceReport.GroupName);
                }

                if (!string.IsNullOrEmpty(invoiceReport.filterType))
                {
                    if (invoiceReport.filterType == "currentMonth")
                    {
                        var startDate = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1);
                        var endDate = startDate.AddMonths(1).AddDays(-1);
                        query = query.Where(s => s.s.Date >= startDate && s.s.Date <= endDate);
                    }
                    else if (invoiceReport.filterType == "currentYear")
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
                    else if (invoiceReport.filterType == "betweenYear" && !string.IsNullOrEmpty(invoiceReport.SelectedYear))
                    {
                        var years = invoiceReport.SelectedYear.Split('-');
                        int startYear = int.Parse(years[0]);
                        int endYear = int.Parse(years[1]);

                        var startOfSelectedFinancialYear = new DateTime(startYear, 4, 1);
                        var endOfSelectedFinancialYear = new DateTime(endYear, 3, 31);

                        query = query.Where(s => s.s.Date >= startOfSelectedFinancialYear && s.s.Date <= endOfSelectedFinancialYear);
                    }
                }

                if (invoiceReport.endDate.HasValue)
                {
                    query = query.Where(s => s.s.Date <= invoiceReport.endDate.Value);
                }

                var totalRecords = await query.CountAsync();

                var rawList = await query.Select(s => new SupplierInvoiceModel
                {
                    Id = s.s.Id,
                    InvoiceNo = s.s.InvoiceNo,
                    SiteId = s.s.SiteId,
                    SupplierId = s.s.SupplierId,
                    CompanyId = s.s.CompanyId,
                    TotalAmount = s.s.TotalAmount,
                    GroupName = s.s.SiteGroup,
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
                }).ToListAsync();

                // Group by SupplierName and order by SupplierName asc, then date asc
                var SupplierInvoiceList = rawList
                    .GroupBy(i => i.SupplierName)
                    .OrderBy(g => g.Key)
                    .SelectMany(g => g.OrderBy(i => i.Date))
                    .ToList();

                var CreditTotalAmount = SupplierInvoiceList
                    .Where(i => i.InvoiceNo != "PayOut" &&
                                i.InvoiceType != "Purchase Return" &&
                                i.InvoiceType != "Credit Note")
                    .Sum(i => i.TotalAmount);

                var DebitTotalAmount = SupplierInvoiceList
                    .Where(i => i.InvoiceNo == "PayOut" ||
                                i.InvoiceType == "Purchase Return" ||
                                i.InvoiceType == "Credit Note")
                    .Sum(i => i.TotalAmount);

                var PendingTotalAmount = CreditTotalAmount - DebitTotalAmount;

                var PayOutDetails = new InvoiceTotalAmount
                {
                    InvoiceList = SupplierInvoiceList,
                    TotalPending = PendingTotalAmount,
                    TotalCreadit = CreditTotalAmount,
                    TotalPurchase = DebitTotalAmount
                };

                return PayOutDetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
    }
}

