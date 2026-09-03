using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.ItemInWord;
using AccountManagement.DBContext.Models.ViewModels.ItemMaster;
using AccountManagement.DBContext.Models.ViewModels.PurchaseRequest;
//using AccountManagement.Repository.Interface.Repository.IItemInWord;
using AccountManagement.Repository.Interface.Repository.PurchaseOrder;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using AccountManagement.Repository.Interface.Repository.IItemInWord;

namespace AccountManagement.Repository.Repository.ItemInWordRepository
{
    public class ItemInWordRepo : IItemInward
    {
        public ItemInWordRepo(DbaccManegmentContext context)
        {
            Context = context;
        }

        public DbaccManegmentContext Context { get; }

        public async Task<ApiResponseModel> AddItemInWordDetails(ItemInWordModel ItemInWordDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var itemInword = new ItemInword()
                {
                    InwordId = Guid.NewGuid(),
                    SiteId = ItemInWordDetails.SiteId,
                    ItemId = ItemInWordDetails.ItemId,
                    Item = ItemInWordDetails.Item,
                    UnitTypeId = ItemInWordDetails.UnitTypeId,
                    Quantity = ItemInWordDetails.Quantity,
                    DocumentName = ItemInWordDetails.DocumentName,
                    Date = DateTime.Now,
                    VehicleNumber = ItemInWordDetails.VehicleNumber.ToUpper(),
                    ReceiverName = ItemInWordDetails.ReceiverName,
                    IsApproved = ItemInWordDetails.IsApproved,
                    IsDeleted = ItemInWordDetails.IsDeleted,
                    CreatedBy = ItemInWordDetails.CreatedBy,
                    CreatedOn = DateTime.Now,
                    InvoiceNo = ItemInWordDetails.InvoiceNo
                };
                response.code = (int)HttpStatusCode.OK;
                response.message = "Item inward successfully created.";
                Context.ItemInwords.Add(itemInword);
                Context.SaveChanges();
            }
            catch (Exception)
            {
                throw;
            }
            return response;
        }

        public async Task<ApiResponseModel> DeleteItemInWord(Guid InwordId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var itemInWordDetails = Context.ItemInwords.Where(a => a.InwordId == InwordId).FirstOrDefault();
                if (itemInWordDetails != null)
                {
                    itemInWordDetails.IsDeleted = true;
                    Context.ItemInwords.Update(itemInWordDetails);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = itemInWordDetails;
                    response.message = "Item inward successfully deleted.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Error in deleting item inward.";
                }
                Context.SaveChanges();
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return response;
        }

        public async Task<IEnumerable<ItemInWordModel>> GetItemInWordList(InwardListRequestModel request)
        {
            try
            {
                var ItemInWordList = (from a in Context.ItemInwords
                                      join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                      join c in Context.Sites on a.SiteId equals c.SiteId
                                      join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                      join j in Context.SupplierMasters on a.SupplierId equals j.SupplierId into supplierGroup
                                      from j in supplierGroup.DefaultIfEmpty()
                                      where a.IsDeleted == false && (request.siteId == null || a.SiteId == request.siteId)
                                      select new ItemInWordModel
                                      {
                                          InwordId = a.InwordId,
                                          SiteId = a.SiteId,
                                          SiteName = c.SiteName,
                                          ItemId = a.ItemId,
                                          Item = i.ItemName,
                                          UnitTypeId = a.UnitTypeId,
                                          Quantity = a.Quantity,
                                          DocumentName = a.DocumentName,
                                          Date = a.Date,
                                          ReceiverName = a.ReceiverName,
                                          VehicleNumber = a.VehicleNumber,
                                          CreatedBy = a.CreatedBy,
                                          CreatedOn = a.CreatedOn,
                                          IsApproved = a.IsApproved,
                                          SupplierId = a.SupplierId,
                                          SupplierName = j != null ? j.SupplierName : null,
                                          InvoiceNo = a.InvoiceNo
                                      });

                if (!string.IsNullOrEmpty(request.searchText))
                {
                    request.searchText = request.searchText.ToLower();
                    ItemInWordList = ItemInWordList.Where(u =>
                        u.Item.ToLower().Contains(request.searchText) ||
                        u.Quantity.ToString().Contains(request.searchText)
                    );
                }

                if (!string.IsNullOrEmpty(request.searchText) && !string.IsNullOrEmpty(request.searchBy))
                {
                    request.searchText = request.searchText.ToLower();
                    switch (request.searchBy.ToLower())
                    {
                        case "itemname":
                            ItemInWordList = ItemInWordList.Where(u => u.Item.ToLower().Contains(request.searchText));
                            break;
                        default:

                            break;
                    }
                }

                if (string.IsNullOrEmpty(request.sortBy))
                {
                    ItemInWordList = ItemInWordList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = request.sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = request.sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "item":
                            if (sortOrder == "ascending")
                                ItemInWordList = ItemInWordList.OrderBy(u => u.Item);
                            else if (sortOrder == "descending")
                                ItemInWordList = ItemInWordList.OrderByDescending(u => u.Item);
                            break;
                        case "createdon":
                            if (sortOrder == "ascending")
                                ItemInWordList = ItemInWordList.OrderBy(u => u.CreatedOn);
                            else if (sortOrder == "descending")
                                ItemInWordList = ItemInWordList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:

                            break;
                    }
                }

                return ItemInWordList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ItemInWordMasterView> GetItemInWordtDetailsById(Guid InwordId)
        {
            ItemInWordMasterView itemInWordList = new ItemInWordMasterView();
            try
            {
                itemInWordList = (from a in Context.ItemInwords.Where(x => x.InwordId == InwordId)
                                  join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                  join c in Context.Sites on a.SiteId equals c.SiteId
                                  join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                  join s in Context.SupplierMasters on a.SupplierId equals s.SupplierId into supplierGroup
                                  from s in supplierGroup.DefaultIfEmpty()
                                  select new ItemInWordMasterView
                                  {
                                      InwordId = a.InwordId,
                                      SiteId = a.SiteId,
                                      SiteName = c.SiteName,
                                      ItemId = a.ItemId,
                                      Item = i.ItemName,
                                      UnitTypeId = a.UnitTypeId,
                                      UnitName = b.UnitName,
                                      Quantity = a.Quantity,
                                      DocumentName = a.DocumentName,
                                      ReceiverName = a.ReceiverName,
                                      VehicleNumber = a.VehicleNumber,
                                      Date = a.Date,
                                      IsApproved = a.IsApproved,
                                      CreatedBy = a.CreatedBy,
                                      CreatedOn = a.CreatedOn,
                                      SupplierId = a.SupplierId,
                                      SupplierName = s != null ? s.SupplierName : null,
                                      InwardInvoiceNo = a.InvoiceNo
                                  }).First();

                List<ItemInWordDocumentModel> documentList = (from a in Context.ItemInWordDocuments.Where(a => a.RefInWordId == itemInWordList.InwordId)
                                                              select new ItemInWordDocumentModel
                                                              {
                                                                  Id = a.Id,
                                                                  RefInWordId = a.RefInWordId,
                                                                  DocumentName = a.DocumentName,
                                                              }).ToList();
                itemInWordList.DocumentLists = documentList;
                return itemInWordList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> ItemInWordIsApproved(Guid InwordId)
        {
            ApiResponseModel response = new ApiResponseModel();
            var itemInWordData = Context.ItemInwords.Where(a => a.InwordId == InwordId).FirstOrDefault();

            if (itemInWordData != null)
            {

                if (itemInWordData.IsApproved == true)
                {
                    itemInWordData.IsApproved = false;
                    Context.ItemInwords.Update(itemInWordData);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = itemInWordData;
                    response.message = "Item inward is successfully unapproved.";
                }
                else
                {
                    itemInWordData.IsApproved = true;
                    Context.ItemInwords.Update(itemInWordData);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = itemInWordData;
                    response.message = "Item inward is successfully approved.";
                }
            }
            return response;
        }

        public async Task<ApiResponseModel> UpdateItemInWordDetails(ItemInWordModel ItemInWordDetails)
        {
            ApiResponseModel model = new ApiResponseModel();
            var ItemInWordData = Context.ItemInwords.Where(e => e.InwordId == ItemInWordDetails.InwordId).FirstOrDefault();
            try
            {
                if (ItemInWordData != null)
                {
                    ItemInWordData.InwordId = ItemInWordDetails.InwordId;
                    ItemInWordData.ItemId = ItemInWordDetails.ItemId;
                    ItemInWordData.Item = ItemInWordDetails.Item;
                    ItemInWordData.UnitTypeId = ItemInWordDetails.UnitTypeId;
                    ItemInWordData.Quantity = ItemInWordDetails.Quantity;
                    ItemInWordData.DocumentName = ItemInWordDetails.DocumentName;
                    ItemInWordData.ReceiverName = ItemInWordDetails.ReceiverName;
                    ItemInWordData.VehicleNumber = ItemInWordDetails.VehicleNumber;
                    ItemInWordData.Date = ItemInWordDetails.Date;
                    ItemInWordData.InvoiceNo = ItemInWordData.InvoiceNo;

                }
                Context.ItemInwords.Update(ItemInWordData);
                Context.SaveChanges();
                model.code = 200;
                model.message = "Item inward details successfully updated.";
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return model;
        }

        public async Task<ApiResponseModel> InsertMultipleItemInWordDetails(ItemInWordMasterView firstItemInWordDetail)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var ItemDetails = new ItemInword()
                {
                    InwordId = Guid.NewGuid(),
                    SiteId = firstItemInWordDetail.SiteId,
                    ItemId = firstItemInWordDetail.ItemId,
                    Item = firstItemInWordDetail.Item,
                    UnitTypeId = firstItemInWordDetail.UnitTypeId,
                    Quantity = firstItemInWordDetail.Quantity,
                    DocumentName = firstItemInWordDetail.DocumentName,
                    Date = firstItemInWordDetail.Date,
                    VehicleNumber = firstItemInWordDetail.VehicleNumber.ToUpper(),
                    ReceiverName = firstItemInWordDetail.ReceiverName,
                    IsApproved = firstItemInWordDetail.IsApproved,
                    SupplierId = firstItemInWordDetail.SupplierId,
                    IsDeleted = false,
                    CreatedBy = firstItemInWordDetail.CreatedBy,
                    CreatedOn = DateTime.Now,
                    InvoiceNo = firstItemInWordDetail.InwardInvoiceNo
                };
                Context.ItemInwords.Add(ItemDetails);
                foreach (var item in firstItemInWordDetail.DocumentLists)
                {
                    var DocumentDetailS = new ItemInWordDocument()
                    {
                        RefInWordId = ItemDetails.InwordId,
                        DocumentName = item.DocumentName,
                    };
                    Context.ItemInWordDocuments.Add(DocumentDetailS);
                }

                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "Item inward successfully inserted.";
            }
            catch (Exception ex)
            {
                response.code = 400;
                response.message = "Error creating item inward: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> UpdatetMultipleItemInWordDetails(ItemInWordMasterView UpdateInWordDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var ItemInWordData = await Context.ItemInwords.FindAsync(UpdateInWordDetails.InwordId);
                if (ItemInWordData == null)
                {
                    response.code = (int)HttpStatusCode.NotFound;
                    response.message = $"Item inward with ID {UpdateInWordDetails.InwordId} not found";
                    return response;
                }
                else
                {
                    ItemInWordData.InwordId = UpdateInWordDetails.InwordId;
                    ItemInWordData.ItemId = UpdateInWordDetails.ItemId;
                    ItemInWordData.Item = UpdateInWordDetails.Item;
                    ItemInWordData.UnitTypeId = UpdateInWordDetails.UnitTypeId;
                    ItemInWordData.Quantity = UpdateInWordDetails.Quantity;
                    ItemInWordData.ReceiverName = UpdateInWordDetails.ReceiverName;
                    ItemInWordData.VehicleNumber = UpdateInWordDetails.VehicleNumber;
                    ItemInWordData.Date = UpdateInWordDetails.Date;
                    ItemInWordData.SiteId = UpdateInWordDetails.SiteId;
                    ItemInWordData.SupplierId = UpdateInWordDetails.SupplierId;
                    ItemInWordData.InvoiceNo = UpdateInWordDetails.InwardInvoiceNo;

                    Context.ItemInwords.Update(ItemInWordData);
                }

                var documentNames = UpdateInWordDetails.DocumentName.Split(';');
                var existingDocuments = Context.ItemInWordDocuments.Where(d => d.RefInWordId == UpdateInWordDetails.InwordId).ToList();
                foreach (var existingDoc in existingDocuments)
                {
                    if (documentNames.Contains(existingDoc.DocumentName))
                    {
                        Context.ItemInWordDocuments.Update(existingDoc);
                    }
                    else
                    {
                        Context.ItemInWordDocuments.Remove(existingDoc);
                    }
                }
                foreach (var item in UpdateInWordDetails.DocumentLists)
                {
                    var DocumentDetailS = new ItemInWordDocument()
                    {
                        RefInWordId = ItemInWordData.InwordId,
                        DocumentName = item.DocumentName,
                    };
                    Context.ItemInWordDocuments.Add(DocumentDetailS);
                }
                await Context.SaveChangesAsync();
                response.code = (int)HttpStatusCode.OK;
                response.message = "Item inward successfully updated.";
            }
            catch (Exception ex)
            {
                response.code = 400;
                response.message = "Error updating item inward: " + ex.Message;
            }
            return response;
        }

        public async Task<ApiResponseModel> MultipleInwardIsApproved(InwardIsApprovedMasterModel InwardList)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var approvalDict = InwardList.InwardList.ToDictionary(x => x.InwardId, x => x.IsApproved);
                var requestedIds = approvalDict.Keys.ToList();

                // Load ONLY the inwards being approved. This previously read every
                // ItemInword in the table and called Update() on all of them, so
                // approving a single inward issued an UPDATE against every row — a
                // full-table rewrite that also clobbered any concurrent edit.
                // Note the spelling: the request model says InwardId, the entity
                // says InwordId. They are the same key.
                // See Migration-Assessment/05-Performance-Analysis.md, finding P2.
                var allInwardData = await Context.ItemInwords
                    .Where(x => requestedIds.Contains(x.InwordId))
                    .ToListAsync();

                foreach (var Inward in allInwardData)
                {
                    if (approvalDict.TryGetValue(Inward.InwordId, out var isApproved))
                    {
                        Inward.IsApproved = isApproved ?? false;
                    }

                    Context.ItemInwords.Update(Inward);
                }
                await Context.SaveChangesAsync();

                response.code = 200;
                response.message = "Inward approved successfully.";
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error approving the Inward: " + ex.Message;
            }
            return response;
        }


    }
}

