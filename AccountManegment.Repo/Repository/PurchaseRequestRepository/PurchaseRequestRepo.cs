using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.Repository.Domain;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.PurchaseOrder;
using AccountManagement.DBContext.Models.ViewModels.PurchaseRequest;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;
using AccountManagement.Repository.Interface.Repository.PurchaseRequest;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.PurchaseRequestRepository
{
    public class PurchaseRequestRepo : IPurchaseRequest
    {
        public PurchaseRequestRepo(DbaccManegmentContext context)
        {
            Context = context;
        }

        public DbaccManegmentContext Context { get; }

        public string CheckPRNo()
        {
            try
            {
                var LastPr = Context.PurchaseRequests.OrderByDescending(e => e.CreatedOn).FirstOrDefault();
                var currentDate = DateTime.Now;

                var financialYear = FinancialYear.CurrentAsProduced(currentDate);
                int currentYear = financialYear.EndYear;
                int lastYear = financialYear.StartYear;

                string PurchaseRequestId;
                if (LastPr == null)
                {

                    PurchaseRequestId = $"PR/{(lastYear % 100).ToString("D2")}-{(currentYear % 100).ToString("D2")}/001";
                }
                else
                {
                    if (LastPr.PrNo.Length >= 12)
                    {

                        int PrNumber = int.Parse(LastPr.PrNo.Substring(11)) + 1;
                        PurchaseRequestId = $"PR/{(lastYear % 100).ToString("D2")}-{(currentYear % 100).ToString("D2")}/" + PrNumber.ToString("D3");
                    }
                    else
                    {
                        throw new Exception("Purchaserequest id does not have the expected format.");
                    }
                }
                return PurchaseRequestId;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }


        public async Task<ApiResponseModel> AddPurchaseRequestDetails(PurchaseRequestModel PurchaseRequestDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var purchaseRequest = new PurchaseRequest()
                {
                    Pid = Guid.NewGuid(),
                    PrNo = PurchaseRequestDetails.PrNo,
                    ItemId = PurchaseRequestDetails.ItemId,
                    Date = PurchaseRequestDetails.Date,
                    ItemName = PurchaseRequestDetails.ItemName,
                    ItemDescription = PurchaseRequestDetails.ItemDescription,
                    UnitTypeId = PurchaseRequestDetails.UnitTypeId,
                    Quantity = PurchaseRequestDetails.Quantity,
                    SiteId = PurchaseRequestDetails.SiteId,
                    IsApproved = PurchaseRequestDetails.IsApproved,
                    IsDeleted = false,
                    CreatedBy = PurchaseRequestDetails.CreatedBy,
                    CreatedOn = DateTime.Now,
                    SiteAddressId = PurchaseRequestDetails.SiteAddressId,
                    SiteAddress = PurchaseRequestDetails.SiteAddress,
                };
                response.code = (int)HttpStatusCode.OK;
                response.message = "Purchase request successfully created.";
                Context.PurchaseRequests.Add(purchaseRequest);
                Context.SaveChanges();
            }
            catch (Exception)
            {
                throw;
            }
            return response;
        }

        public async Task<ApiResponseModel> DeletePurchaseRequest(Guid PurchaseId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var purchaseDetails = Context.PurchaseRequests.Where(a => a.Pid == PurchaseId).FirstOrDefault();
                if (purchaseDetails != null)
                {
                    purchaseDetails.IsDeleted = true;
                    Context.PurchaseRequests.Update(purchaseDetails);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = purchaseDetails;
                    response.message = "Purchaserequest is deleted successfully";
                }
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return response;
        }

        public async Task<PurchaseRequestModel> GetPurchaseRequestDetailsById(Guid PurchaseId)
        {
            PurchaseRequestModel purchaseRequestList = new PurchaseRequestModel();
            try
            {
                purchaseRequestList = (from a in Context.PurchaseRequests.Where(x => x.Pid == PurchaseId)
                                       join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                       join c in Context.Sites on a.SiteId equals c.SiteId
                                       join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                       select new PurchaseRequestModel
                                       {
                                           Pid = a.Pid,
                                           PrNo = a.PrNo,
                                           ItemId = a.ItemId,
                                           Date = a.Date,
                                           ItemName = i.ItemName,
                                           ItemDescription = a.ItemDescription,
                                           UnitTypeId = a.UnitTypeId,
                                           Quantity = a.Quantity,
                                           UnitName = b.UnitName,
                                           IsApproved = a.IsApproved,
                                           SiteId = a.SiteId,
                                           SiteName = c.SiteName,
                                           CreatedBy = a.CreatedBy,
                                           CreatedOn = a.CreatedOn,
                                           SiteAddress = a.SiteAddress,
                                           SiteAddressId = a.SiteAddressId,
                                       }).First();
                return purchaseRequestList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<PurchaseRequestModel>> GetPurchaseRequestList(string? searchText, string? searchBy, string? sortBy, Guid? siteId)
        {
            try
            {
                var PurchaseRequestList = from a in Context.PurchaseRequests
                                          join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                          join c in Context.Sites on a.SiteId equals c.SiteId
                                          join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                          where (siteId == null || a.SiteId == siteId) && c.IsActive == true &&
                                          a.IsDeleted == false
                                          select new PurchaseRequestModel
                                          {
                                              Pid = a.Pid,
                                              ItemName = i.ItemName,
                                              ItemId = a.ItemId,
                                              PrNo = a.PrNo,
                                              Date = a.Date,
                                              Quantity = a.Quantity,
                                              UnitTypeId = a.UnitTypeId,
                                              UnitName = b.UnitName,
                                              ItemDescription = a.ItemDescription,
                                              SiteId = a.SiteId,
                                              SiteName = c.SiteName,
                                              CreatedBy = a.CreatedBy,
                                              CreatedOn = a.CreatedOn,
                                              IsApproved = a.IsApproved,
                                              SiteAddress = a.SiteAddress,
                                              SiteAddressId = a.SiteAddressId
                                          };


                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    PurchaseRequestList = PurchaseRequestList.Where(u =>
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
                            PurchaseRequestList = PurchaseRequestList.Where(u => u.UnitName.ToLower().Contains(searchText));
                            break;
                        case "itemname":
                            PurchaseRequestList = PurchaseRequestList.Where(u => u.ItemName.ToLower().Contains(searchText));
                            break;
                        default:

                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {

                    PurchaseRequestList = PurchaseRequestList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "item":
                            PurchaseRequestList = sortOrder == "ascending" ? PurchaseRequestList.OrderBy(u => u.ItemName) : PurchaseRequestList.OrderByDescending(u => u.ItemName);
                            break;
                        case "createdon":
                            PurchaseRequestList = sortOrder == "ascending" ? PurchaseRequestList.OrderBy(u => u.CreatedOn) : PurchaseRequestList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:

                            break;
                    }
                }

                return await PurchaseRequestList.ToListAsync();
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }


        public async Task<ApiResponseModel> UpdatePurchaseRequestDetails(PurchaseRequestModel PurchaseRequestDetails)
        {
            ApiResponseModel model = new ApiResponseModel();
            var PurchaseRequestData = Context.PurchaseRequests.Where(e => e.Pid == PurchaseRequestDetails.Pid).FirstOrDefault();
            try
            {
                if (PurchaseRequestData != null)
                {
                    PurchaseRequestData.Pid = PurchaseRequestDetails.Pid;
                    PurchaseRequestData.PrNo = PurchaseRequestDetails.PrNo;
                    PurchaseRequestData.ItemId = PurchaseRequestDetails.ItemId;
                    PurchaseRequestData.Date = PurchaseRequestDetails.Date;
                    PurchaseRequestData.ItemDescription = PurchaseRequestDetails.ItemDescription;
                    PurchaseRequestData.Quantity = PurchaseRequestDetails.Quantity;
                    PurchaseRequestData.UnitTypeId = PurchaseRequestDetails.UnitTypeId;
                    PurchaseRequestData.SiteId = PurchaseRequestDetails.SiteId;
                    PurchaseRequestData.SiteAddressId = PurchaseRequestDetails.SiteAddressId;
                    PurchaseRequestData.SiteAddress = PurchaseRequestDetails.SiteAddress == "--Select Site Address--" ? null : PurchaseRequestDetails.SiteAddress;
                    PurchaseRequestData.ItemName = PurchaseRequestDetails.ItemName;
                }
                Context.PurchaseRequests.Update(PurchaseRequestData);
                Context.SaveChanges();
                model.code = 200;
                model.message = "Purchase request details successfully updated.";
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return model;
        }
        public async Task<ApiResponseModel> PurchaseRequestIsApproved(Guid PurchaseId)
        {

            ApiResponseModel response = new ApiResponseModel();
            var purchaseRequestData = Context.PurchaseRequests.Where(a => a.Pid == PurchaseId).FirstOrDefault();

            if (purchaseRequestData != null)
            {

                if (purchaseRequestData.IsApproved == true)
                {
                    purchaseRequestData.IsApproved = false;
                    Context.PurchaseRequests.Update(purchaseRequestData);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = purchaseRequestData;
                    response.message = "Purchase request is successfully unapprove.!";
                }

                else
                {
                    purchaseRequestData.IsApproved = true;
                    Context.PurchaseRequests.Update(purchaseRequestData);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = purchaseRequestData;
                    response.message = "Purchase request is successfully approved.";
                }
            }
            return response;
        }
        public async Task<ApiResponseModel> MultiplePurchaseRequestIsApproved(PRIsApprovedMasterModel PRIdList)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var approvalDict = PRIdList.PRList.ToDictionary(x => x.Pid, x => x.IsApproved);
                var requestedIds = approvalDict.Keys.ToList();

                // Load ONLY the requests being approved. This previously read every
                // PurchaseRequest in the table and called Update() on all of them, so
                // approving a single request issued an UPDATE against every row — a
                // full-table rewrite that also clobbered any concurrent edit.
                // See Migration-Assessment/05-Performance-Analysis.md, finding P2.
                var allPRData = await Context.PurchaseRequests
                    .Where(x => requestedIds.Contains(x.Pid))
                    .ToListAsync();

                foreach (var PR in allPRData)
                {
                    if (approvalDict.TryGetValue(PR.Pid, out var isApproved))
                    {
                        PR.IsApproved = isApproved;
                    }

                    Context.PurchaseRequests.Update(PR);
                }
                await Context.SaveChangesAsync();

                response.code = 200;
                response.message = "Purchase request approved/unapproved successfully.";
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error approving the purchase requests: " + ex.Message;
            }
            return response;
        }
    }
}
