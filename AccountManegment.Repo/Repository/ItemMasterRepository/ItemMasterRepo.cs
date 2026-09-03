using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.InvoiceMaster;
using AccountManagement.DBContext.Models.ViewModels.ItemMaster;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Repository.ItemMaster;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.ItemMasterRepository
{
    public class ItemMasterRepo : IItemMaster
    {
        public ItemMasterRepo(DbaccManegmentContext context)
        {
            Context = context;
        }
        public DbaccManegmentContext Context { get; }

        public async Task<ApiResponseModel> AddItemDetails(ItemMasterModel ItemDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                if (ItemDetails != null)
                {
                    var existingItem = Context.ItemMasters.FirstOrDefault(x => x.ItemName == ItemDetails.ItemName);
                    if (existingItem != null)
                    {
                        if (existingItem.IsDeleted == true)
                        {
                            existingItem.UnitType = ItemDetails.UnitType;
                            existingItem.PricePerUnit = ItemDetails.PricePerUnit;
                            existingItem.IsWithGst = ItemDetails.IsWithGst;
                            existingItem.Gstamount = ItemDetails.Gstamount;
                            existingItem.Gstper = ItemDetails.Gstper;
                            existingItem.Hsncode = ItemDetails.Hsncode;
                            existingItem.IsDeleted = ItemDetails.IsDeleted;
                            existingItem.IsApproved = ItemDetails.IsApproved;
                            existingItem.CreatedBy = ItemDetails.CreatedBy;
                            existingItem.CreatedOn = DateTime.Now;

                            Context.ItemMasters.Update(existingItem);
                            Context.SaveChanges();
                            response.code = (int)HttpStatusCode.OK;
                            response.message = "Item successfully inserted.";

                        }
                        else
                        {
                            response.code = 403;
                            response.message = "Item already exist";
                        }
                    }
                    else
                    {
                        var ItemMaster = new ItemMaster()
                        {
                            ItemId = Guid.NewGuid(),
                            ItemName = ItemDetails.ItemName,
                            UnitType = ItemDetails.UnitType,
                            PricePerUnit = ItemDetails.PricePerUnit,
                            IsWithGst = ItemDetails.IsWithGst,
                            Gstamount = ItemDetails.Gstamount,
                            Gstper = ItemDetails.Gstper,
                            Hsncode = ItemDetails.Hsncode,
                            IsDeleted = ItemDetails.IsDeleted,
                            IsApproved = ItemDetails.IsApproved,
                            CreatedBy = ItemDetails.CreatedBy,
                            CreatedOn = DateTime.Now,
                        };
                        response.code = (int)HttpStatusCode.OK;
                        response.message = "Item successfully inserted.";
                        Context.ItemMasters.Add(ItemMaster);
                        Context.SaveChanges();
                    }
                }
                else
                {
                    response.code = 400;
                    response.message = "Itemdetails is null";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "An error occurred while processing the request";
            }
            return response;
        }


        public async Task<ApiResponseModel> DeleteItemDetails(Guid ItemId)
        {
            ApiResponseModel response = new ApiResponseModel();
            var GetItemdata = Context.ItemMasters.Where(a => a.ItemId == ItemId).FirstOrDefault();
            var InvoiceDetails = Context.SupplierInvoiceDetails.Where(s => s.ItemId == ItemId).ToList();
            if (GetItemdata != null)
            {
                if (InvoiceDetails.Count > 0)
                {
                    response.code = 404;
                    response.message = "Invoice is created for this Item.";
                }
                else
                {
                    GetItemdata.IsDeleted = true;
                    Context.ItemMasters.Update(GetItemdata);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = GetItemdata;
                    response.message = "Item is successfully deleted.";
                }
            }
            return response;
        }

        public async Task<IEnumerable<UnitMasterView>> GetAllUnitType()
        {
            try
            {
                IEnumerable<UnitMasterView> UnitType = Context.UnitMasters.ToList().Select(a => new UnitMasterView
                {
                    UnitId = a.UnitId,
                    UnitName = a.UnitName,
                });
                return UnitType;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ItemMasterModel> GetItemDetailsById(Guid ItemId)
        {
            ItemMasterModel ItemList = new ItemMasterModel();
            try
            {
                ItemList = (from a in Context.ItemMasters.Where(x => x.ItemId == ItemId)
                            join b in Context.UnitMasters on a.UnitType equals b.UnitId
                            select new ItemMasterModel
                            {
                                ItemId = a.ItemId,
                                ItemName = a.ItemName,
                                UnitType = a.UnitType,
                                UnitTypeName = b.UnitName,
                                PricePerUnit = a.PricePerUnit,
                                IsWithGst = a.IsWithGst,
                                Gstamount = a.Gstamount,
                                Gstper = a.Gstper,
                                Hsncode = a.Hsncode,
                                IsApproved = a.IsApproved,
                                CreatedBy = a.CreatedBy,
                                CreatedOn = a.CreatedOn,
                            }).First();
                return ItemList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<ItemMasterModel>> GetItemList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                var ItemList = (from a in Context.ItemMasters
                                join b in Context.UnitMasters on a.UnitType equals b.UnitId
                                where a.IsDeleted == false
                                select new ItemMasterModel
                                {
                                    ItemId = a.ItemId,
                                    ItemName = a.ItemName,
                                    UnitType = a.UnitType,
                                    UnitTypeName = b.UnitName,
                                    PricePerUnit = a.PricePerUnit,
                                    IsWithGst = a.IsWithGst,
                                    Gstamount = a.Gstamount,
                                    Gstper = a.Gstper,
                                    Hsncode = a.Hsncode,
                                    IsApproved = a.IsApproved,
                                    CreatedOn = a.CreatedOn,
                                });
                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    ItemList = ItemList.Where(u =>
                        u.ItemName.ToLower().Contains(searchText) ||
                        u.PricePerUnit.ToString().Contains(searchText) ||
                        u.IsApproved.ToString().Contains(searchText)
                    );
                }

                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "itemname":
                            ItemList = ItemList.Where(u => u.ItemName.ToLower().Contains(searchText));
                            break;
                        case "isapproved":
                            ItemList = ItemList.Where(u => u.IsApproved.ToString().Contains(searchText));
                            break;
                        case "perunitprice":
                            ItemList = ItemList.Where(u => u.PricePerUnit.ToString().Contains(searchText));
                            break;
                        default:

                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {
                    ItemList = ItemList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "createdon":
                            if (sortOrder == "ascending")
                                ItemList = ItemList.OrderBy(u => u.CreatedOn);
                            else if (sortOrder == "descending")
                                ItemList = ItemList.OrderByDescending(u => u.CreatedOn);
                            break;
                        case "itemname":
                            if (sortOrder == "ascending")
                                ItemList = ItemList.OrderBy(u => u.ItemName);
                            else if (sortOrder == "descending")
                                ItemList = ItemList.OrderByDescending(u => u.ItemName);
                            break;
                        case "perunitprice":
                            if (sortOrder == "ascending")
                                ItemList = ItemList.OrderBy(u => u.PricePerUnit);
                            else if (sortOrder == "descending")
                                ItemList = ItemList.OrderByDescending(u => u.PricePerUnit);
                            break;
                        default:
                            break;
                    }
                }
                return ItemList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<ItemMasterModel>> GetItemNameList()
        {
            try
            {
                IEnumerable<ItemMasterModel> ItemName = Context.ItemMasters
                    .Where(e => e.IsDeleted == false && e.IsApproved == true)
                    .OrderByDescending(e => e.CreatedOn)
                    .Select(a => new ItemMasterModel
                    {
                        ItemId = a.ItemId,
                        ItemName = a.ItemName,
                    })
                    .ToList();
                return ItemName;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> ItemIsApproved(Guid ItemId)
        {
            ApiResponseModel response = new ApiResponseModel();
            var ItemData = Context.ItemMasters.Where(a => a.ItemId == ItemId).FirstOrDefault();

            if (ItemData != null)
            {

                if (ItemData.IsApproved == true)
                {
                    ItemData.IsApproved = false;
                    Context.ItemMasters.Update(ItemData);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = ItemData;
                    response.message = "Item is successfully unapproved.";
                }

                else
                {
                    ItemData.IsApproved = true;
                    Context.ItemMasters.Update(ItemData);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = ItemData;
                    response.message = "Item is successfully approved ";
                }
            }
            else
            {
                response.code = 400;
                response.message = "Error,Item doesnot approved or unapproved ";
            }
            return response;
        }

        public async Task<ApiResponseModel> UpdateItemDetails(ItemMasterModel ItemDetails)
        {
            ApiResponseModel model = new ApiResponseModel();
            var ItemMaster = Context.ItemMasters.Where(e => e.ItemId == ItemDetails.ItemId).FirstOrDefault();
            try
            {
                if (ItemMaster != null)
                {
                    ItemMaster.ItemId = ItemDetails.ItemId;
                    ItemMaster.ItemName = ItemDetails.ItemName;
                    ItemMaster.UnitType = ItemDetails.UnitType;
                    ItemMaster.PricePerUnit = ItemDetails.PricePerUnit;
                    ItemMaster.IsWithGst = ItemDetails.IsWithGst;
                    ItemMaster.Gstamount = ItemDetails.Gstamount;
                    ItemMaster.Gstper = ItemDetails.Gstper;
                    ItemMaster.Hsncode = ItemDetails.Hsncode;


                    Context.ItemMasters.Update(ItemMaster);
                    Context.SaveChanges();
                    model.code = 200;
                    model.message = "Item details successfully updated.";
                }
                else
                {
                    model.code = 400;
                    model.message = "Error updating item details.";
                }
            }
            catch (Exception ex)
            {
                model.code = 500;
                model.message = "Error updating item details:" + ex;
            }
            return model;
        }

        public async Task<ApiResponseModel> InsertItemDetailsFromExcel(List<ItemMasterModel> itemDetailsList)
        {
            ApiResponseModel response = new ApiResponseModel();
            List<ItemMaster> itemsToAdd = new List<ItemMaster>();
            List<ItemMaster> itemsToUpdate = new List<ItemMaster>();
            HashSet<string> itemNames = new HashSet<string>();
            try
            {
                foreach (var itemDetails in itemDetailsList)
                {
                    var unitType = await Context.UnitMasters.FirstOrDefaultAsync(x => x.UnitName == itemDetails.UnitTypeName);
                    if (unitType == null)
                    {
                        int index = itemDetailsList.IndexOf(itemDetails) + 1;
                        string itemName = itemDetails.ItemName;
                        response.code = 400;
                        response.message = $": {itemName} at row {index} does not match any data type.";
                        return response;
                    }

                    var existingItem = await Context.ItemMasters.FirstOrDefaultAsync(x => x.ItemName == itemDetails.ItemName);
                    if (existingItem != null)
                    {
                        if (existingItem.IsDeleted == true)
                        {
                            existingItem.UnitType = unitType.UnitId;
                            existingItem.PricePerUnit = itemDetails.PricePerUnit;
                            existingItem.IsWithGst = false;
                            existingItem.Gstamount = itemDetails.Gstamount;
                            existingItem.Gstper = itemDetails.Gstper;
                            existingItem.Hsncode = itemDetails.Hsncode;
                            existingItem.IsDeleted = false;
                            existingItem.IsApproved = true;
                            existingItem.CreatedBy = itemDetails.CreatedBy;
                            existingItem.CreatedOn = DateTime.Now;

                            itemsToUpdate.Add(existingItem);
                        }
                        else
                        {
                            response.code = 400;
                            response.message = $": {itemDetails.ItemName} already exists.";
                            return response;
                        }
                    }
                    else
                    {
                        if (itemNames.Contains(itemDetails.ItemName))
                        {
                            response.code = 400;
                            response.message = $": {itemDetails.ItemName} is duplicated in the data.";
                            return response;
                        }
                        else
                        {
                            itemNames.Add(itemDetails.ItemName);
                        }

                        var itemMaster = new ItemMaster()
                        {
                            ItemId = Guid.NewGuid(),
                            ItemName = itemDetails.ItemName,
                            UnitType = unitType.UnitId,
                            PricePerUnit = itemDetails.PricePerUnit,
                            IsWithGst = false,
                            Gstamount = itemDetails.Gstamount,
                            Gstper = itemDetails.Gstper,
                            Hsncode = itemDetails.Hsncode,
                            IsDeleted = false,
                            IsApproved = true,
                            CreatedBy = itemDetails.CreatedBy,
                            CreatedOn = DateTime.Now,
                        };

                        itemsToAdd.Add(itemMaster);
                    }
                }

                if (itemsToAdd.Any() || itemsToUpdate.Any())
                {
                    if (itemsToAdd.Any())
                    {
                        Context.ItemMasters.AddRange(itemsToAdd);
                    }
                    if (itemsToUpdate.Any())
                    {
                        Context.ItemMasters.UpdateRange(itemsToUpdate);
                    }

                    await Context.SaveChangesAsync();
                    response.code = (int)HttpStatusCode.OK;
                    response.message = "Items details successfully inserted";
                }
                else
                {
                    response.code = 400;
                    response.message = ": Failed to insert item details";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = ": An error occurred while processing the request";
            }
            return response;
        }

        public async Task<IEnumerable<ItemMasterModel>> GetAllItemDetailsList(string? searchText)
        {
            var ItemList = (from a in Context.ItemMasters
                            join b in Context.UnitMasters on a.UnitType equals b.UnitId
                            where a.IsDeleted == false && a.IsApproved == true
                            orderby a.CreatedOn descending
                            select new ItemMasterModel
                            {
                                ItemId = a.ItemId,
                                ItemName = a.ItemName,
                                UnitType = a.UnitType,
                                UnitTypeName = b.UnitName,
                                PricePerUnit = a.PricePerUnit,
                                IsWithGst = a.IsWithGst,
                                Gstamount = a.Gstamount,
                                Gstper = a.Gstper,
                                Hsncode = a.Hsncode,
                                IsApproved = a.IsApproved,
                                CreatedOn = a.CreatedOn,
                            });


            if (!string.IsNullOrEmpty(searchText))
            {
                searchText = searchText.ToLower();
                ItemList = ItemList.Where(u =>
                    u.ItemName.ToLower().Contains(searchText)
                );
            }

            return ItemList;
        }

        public async Task<List<POItemDetailsModel>> GetItemDetailsListById(Guid ItemId)
        {
            try
            {
                var ItemList = new List<POItemDetailsModel>();
                var data = await (from a in Context.ItemMasters.Where(x => x.ItemId == ItemId)
                                  join b in Context.UnitMasters on a.UnitType equals b.UnitId
                                  select new POItemDetailsModel
                                  {
                                      ItemId = a.ItemId,
                                      ItemName = a.ItemName,
                                      UnitType = a.UnitType,
                                      UnitTypeName = b.UnitName,
                                      PricePerUnit = a.PricePerUnit,
                                      Gstamount = a.Gstamount,
                                      GstPercentage = a.Gstper,
                                      Hsncode = a.Hsncode,
                                  }).ToListAsync();
                if (data != null)
                {
                    foreach (var item in data)
                    {
                        ItemList.Add(new POItemDetailsModel()
                        {
                            ItemId = item.ItemId,
                            ItemName = item.ItemName,
                            UnitType = item.UnitType,
                            UnitTypeName = item.UnitTypeName,
                            PricePerUnit = item.PricePerUnit,
                            Gstamount = item.Gstamount,
                            GstPercentage = item.GstPercentage,
                            Hsncode = item.Hsncode,
                        });
                    }
                }
                return ItemList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> MutipleItemsIsApproved(ItemIsApprovedMasterModel ItemIdList)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var approvalDict = ItemIdList.ItemList.ToDictionary(x => x.ItemId, x => x.IsApproved);
                var requestedIds = approvalDict.Keys.ToList();

                // Load ONLY the items being approved. This previously read every
                // ItemMaster in the table and called Update() on all of them, so
                // approving a single item issued an UPDATE against every row — a
                // full-table rewrite that also clobbered any concurrent edit.
                // See Migration-Assessment/05-Performance-Analysis.md, finding P2.
                var allItems = await Context.ItemMasters
                    .Where(x => requestedIds.Contains(x.ItemId))
                    .ToListAsync();

                foreach (var item in allItems)
                {
                    if (approvalDict.TryGetValue(item.ItemId, out var isApproved))
                    {
                        item.IsApproved = isApproved;
                    }

                    Context.ItemMasters.Update(item);
                }
                await Context.SaveChangesAsync();

                response.message = "Item approved/unapproved successfully.";
                response.code = (int)HttpStatusCode.OK;
            }
            catch (Exception ex)
            {
                response.message = "Error in approve - unapprove item.";
                response.code = (int)HttpStatusCode.InternalServerError;
            }
            return response;
        }

        public Task<SupplierInvoiceList> GetItemHistory(Guid ItemId)
        {
            try
            {

                var supplierDataQuery = from a in Context.SupplierInvoices
                                        join e in Context.SupplierInvoiceDetails on a.Id equals e.RefInvoiceId
                                        join b in Context.SupplierMasters on a.SupplierId equals b.SupplierId
                                        join c in Context.Companies on a.CompanyId equals c.CompanyId
                                        join d in Context.Sites on a.SiteId equals d.SiteId
                                        join f in Context.ItemMasters on e.ItemId equals f.ItemId
                                        where a.InvoiceNo != "PayOut" && e.ItemId == ItemId
                                        orderby a.Date
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
                                                GSTper = f.Gstper,
                                                ItemPrice = e.Price,
                                                Itemname = f.ItemName,
                                                ItemPricewithGST = e.Gst,
                                                Quantity = e.Quantity,
                                            },

                                            Item = new SupplierInvoiceDetailsModel
                                            {
                                                RefInvoiceId = e.RefInvoiceId,
                                                ItemId = e.ItemId,
                                                ItemName = f.ItemName,
                                                Price = e.Price,
                                                Gstper = e.Gstper,
                                                Gst = e.Gst,
                                                Quantity = e.Quantity,
                                                TotalAmount = e.TotalAmount,
                                            }
                                        };

                var invoiceData = supplierDataQuery
             .ToList()
             .GroupBy(g => g.Invoice.Id)
             .Select(group => new
             {
                 Invoice = group.First().Invoice,
                 Items = group.GroupBy(g => g.Item.ItemName)
                              .Select(itemGroup => new SupplierInvoiceDetailsModel
                              {
                                  RefInvoiceId = itemGroup.First().Item.RefInvoiceId,
                                  ItemId = itemGroup.First().Item.ItemId,
                                  ItemName = itemGroup.Key,
                                  Quantity = itemGroup.Sum(i => i.Item.Quantity),
                                  TotalAmount = itemGroup.Sum(i => i.Item.TotalAmount)
                              })
                              .ToList()
             })
             .ToList();

                var invoiceList = invoiceData.Select(g => g.Invoice).ToList();
                var invoiceItemList = invoiceData.ToDictionary(g => g.Invoice.Id, g => g.Items.AsEnumerable());

                return Task.FromResult(new SupplierInvoiceList
                {
                    InvoiceList = invoiceList,
                    InvoiceItemList = invoiceItemList
                });
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<POItemDetailsModel> GetItemDetailsByProductId(Guid ItemId)
        {
            try
            {
                var data = (from a in Context.ItemMasters.Where(x => x.ItemId == ItemId)
                            join b in Context.UnitMasters on a.UnitType equals b.UnitId
                            select new POItemDetailsModel
                            {
                                ItemId = a.ItemId,
                                ItemName = a.ItemName,
                                UnitType = a.UnitType,
                                UnitTypeName = b.UnitName,
                                PricePerUnit = a.PricePerUnit,
                                Gstamount = a.Gstamount,
                                GstPercentage = a.Gstper,
                                Hsncode = a.Hsncode,
                            }).FirstOrDefault();
                return data;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
    }
}

