using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.ItemMaster;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Repository.ItemMaster;
using AccountManagement.Repository.Interface.Repository.PurchaseRequest;
using AccountManagement.Repository.Interface.Repository.SiteMaster;
using AccountManagement.Repository.Services.SiteMaster;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Threading.Tasks.Dataflow;

namespace AccountManagement.Repository.Repository.SiteMasterRepository
{
    public class SiteMasterRepo : ISiteMaster
    {
        public SiteMasterRepo(DbaccManegmentContext context)
        {
            Context = context;
        }
        public DbaccManegmentContext Context { get; }

        public async Task<ApiResponseModel> AddSiteDetails(SiteMasterModel SiteDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var existingSite = Context.Sites.FirstOrDefault(x => x.SiteName == SiteDetails.SiteName);
                if (existingSite == null)
                {
                    var SiteMaster = new Site()
                    {
                        SiteId = Guid.NewGuid(),
                        SiteName = SiteDetails.SiteName,
                        IsActive = true,
                        ContectPersonName = SiteDetails.ContectPersonName,
                        ContectPersonPhoneNo = SiteDetails.ContectPersonPhoneNo,
                        Address = SiteDetails.Address,
                        Area = SiteDetails.Area,
                        CityId = SiteDetails.CityId,
                        StateId = SiteDetails.StateId,
                        Country = SiteDetails.Country,
                        Pincode = SiteDetails.Pincode,
                        ShippingAddress = SiteDetails.ShippingAddress,
                        ShippingArea = SiteDetails.ShippingArea,
                        ShippingCityId = SiteDetails.ShippingCityId,
                        ShippingStateId = SiteDetails.ShippingStateId,
                        ShippingCountry = SiteDetails.ShippingCountry,
                        ShippingPincode = SiteDetails.ShippingPincode,
                        IsDeleted = false,
                        CreatedBy = SiteDetails.CreatedBy,
                        CreatedOn = DateTime.Now,
                    };
                    Context.Sites.Add(SiteMaster);

                    if (SiteDetails.SiteShippingAddresses != null)
                    {
                        foreach (var item in SiteDetails.SiteShippingAddresses)
                        {
                            var shippingAddress = new SiteAddress()
                            {
                                SiteId = SiteMaster.SiteId,
                                Address = item.Address,
                                IsDeleted = false,
                            };
                            Context.SiteAddresses.Add(shippingAddress);
                        }
                    }
                    Context.SaveChanges();
                    response.code = (int)HttpStatusCode.OK;
                    response.message = "Site is successfully created.";
                }
                else
                {
                    response.code = 400;
                    response.message = "Site already exists.";
                }
            }
            catch (Exception)
            {
                throw;
            }
            return response;
        }

        public async Task<SiteMasterModel> GetSiteDetailsById(Guid SiteId)
        {
            SiteMasterModel SiteList = new SiteMasterModel();
            try
            {
                SiteList = (from a in Context.Sites.Where(x => x.SiteId == SiteId)
                            join b in Context.Cities on a.CityId equals b.CityId into CityJoin
                            from city in CityJoin.DefaultIfEmpty()
                            join sc in Context.Cities on a.ShippingCityId equals sc.CityId into ShippingCityJoin
                            from shippingCity in ShippingCityJoin.DefaultIfEmpty()
                            join c in Context.States on a.StateId equals c.StatesId
                            join d in Context.Countries on a.Country equals d.CountryId
                            join shippingState in Context.States on a.ShippingStateId equals shippingState.StatesId
                            join shippingCountry in Context.Countries on a.ShippingCountry equals shippingCountry.CountryId
                            select new SiteMasterModel
                            {
                                SiteId = a.SiteId,
                                SiteName = a.SiteName,
                                IsActive = a.IsActive,
                                ContectPersonName = a.ContectPersonName,
                                ContectPersonPhoneNo = a.ContectPersonPhoneNo,
                                Address = a.Address,
                                Area = a.Area,
                                CityId = a.CityId,
                                CityName = city.CityName,
                                StateId = a.StateId,
                                StateName = c.StatesName,
                                Country = a.Country,
                                CountryName = d.CountryName,
                                Pincode = a.Pincode,
                                ShippingAddress = a.ShippingAddress,
                                ShippingArea = a.ShippingArea,
                                ShippingCityId = a.ShippingCityId,
                                ShippingCityName = shippingCity.CityName,
                                ShippingStateId = a.ShippingStateId,
                                ShippingStateName = shippingState.StatesName,
                                ShippingCountry = a.ShippingCountry,
                                ShippingCountryName = shippingCountry.CountryName,
                                ShippingPincode = a.ShippingPincode,
                                CreatedBy = a.CreatedBy,
                                CreatedOn = a.CreatedOn,
                                StateCode = shippingState != null ? shippingState.StateCode : null,
                            }).First();



                List<SiteAddressModel> siteAddress = (from shippingAddress in Context.SiteAddresses.Where(a => a.SiteId == SiteId)
                                                      select new SiteAddressModel
                                                      {
                                                          Aid = shippingAddress.Aid,
                                                          SiteId = shippingAddress.SiteId,
                                                          Address = shippingAddress.Address,
                                                      }).ToList();

                SiteList.SiteShippingAddresses = siteAddress;

                return SiteList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<SiteMasterModel>> GetSiteList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                var SiteList = (from a in Context.Sites
                                join b in Context.Cities on a.CityId equals b.CityId
                                join c in Context.States on a.StateId equals c.StatesId
                                join d in Context.Countries on a.Country equals d.CountryId
                                join e in Context.Countries on a.ShippingCountry equals e.CountryId
                                join f in Context.States on a.ShippingStateId equals f.StatesId
                                join g in Context.Cities on a.ShippingCityId equals g.CityId
                                where a.IsDeleted == false
                                select new SiteMasterModel
                                {
                                    SiteId = a.SiteId,
                                    SiteName = a.SiteName,
                                    IsActive = a.IsActive,
                                    ContectPersonName = a.ContectPersonName,
                                    ContectPersonPhoneNo = a.ContectPersonPhoneNo,
                                    Address = a.Address,
                                    Area = a.Area,
                                    CityId = a.CityId,
                                    CityName = b.CityName,
                                    StateId = a.StateId,
                                    StateName = c.StatesName,
                                    Country = a.Country,
                                    CountryName = d.CountryName,
                                    Pincode = a.Pincode,
                                    ShippingAddress = a.ShippingAddress,
                                    ShippingArea = a.ShippingArea,
                                    ShippingCityId = a.ShippingCityId,
                                    ShippingCityName = g.CityName,
                                    ShippingStateId = a.ShippingStateId,
                                    ShippingStateName = f.StatesName,
                                    ShippingCountry = a.ShippingCountry,
                                    ShippingCountryName = e.CountryName,
                                    ShippingPincode = a.ShippingPincode,
                                    CreatedBy = a.CreatedBy,
                                    CreatedOn = a.CreatedOn,
                                });

                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    SiteList = SiteList.Where(u =>
                        u.SiteName.ToLower().Contains(searchText) ||
                        u.ContectPersonName.ToLower().Contains(searchText)
                    );
                }

                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "sitename":
                            SiteList = SiteList.Where(u => u.SiteName.ToLower().Contains(searchText));
                            break;
                        case "contactpersonname":
                            SiteList = SiteList.Where(u => u.ContectPersonName.ToLower().Contains(searchText));
                            break;
                        default:

                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {
                    SiteList = SiteList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "sitename":
                            if (sortOrder == "ascending")
                                SiteList = SiteList.OrderBy(u => u.SiteName);
                            else if (sortOrder == "descending")
                                SiteList = SiteList.OrderByDescending(u => u.SiteName);
                            break;
                        case "createdon":
                            if (sortOrder == "ascending")
                                SiteList = SiteList.OrderBy(u => u.CreatedOn);
                            else if (sortOrder == "descending")
                                SiteList = SiteList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:

                            break;
                    }
                }

                return SiteList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> UpdateSiteDetails(SiteMasterModel SiteDetails)
        {
            ApiResponseModel model = new ApiResponseModel();
            var SiteMaster = Context.Sites.Where(e => e.SiteId == SiteDetails.SiteId).FirstOrDefault();
            try
            {
                if (SiteMaster != null)
                {
                    SiteMaster.SiteName = SiteDetails.SiteName;
                    SiteMaster.ContectPersonName = SiteDetails.ContectPersonName;
                    SiteMaster.ContectPersonPhoneNo = SiteDetails.ContectPersonPhoneNo;
                    SiteMaster.Address = SiteDetails.Address;
                    SiteMaster.Area = SiteDetails.Area;
                    SiteMaster.CityId = SiteDetails.CityId;
                    SiteMaster.StateId = SiteDetails.StateId;
                    SiteMaster.Country = SiteDetails.Country;
                    SiteMaster.Pincode = SiteDetails.Pincode;
                    SiteMaster.ShippingAddress = SiteDetails.ShippingAddress;
                    SiteMaster.ShippingArea = SiteDetails.ShippingArea;
                    SiteMaster.ShippingCityId = SiteDetails.ShippingCityId;
                    SiteMaster.ShippingStateId = SiteDetails.ShippingStateId;
                    SiteMaster.ShippingCountry = SiteDetails.ShippingCountry;
                    SiteMaster.ShippingPincode = SiteDetails.ShippingPincode;
                }

                Context.Sites.Update(SiteMaster);

                if (SiteDetails.SiteShippingAddresses == null || SiteDetails.SiteShippingAddresses.Count == 0)
                {
                    var siteAddressesToRemove = Context.SiteAddresses.Where(a => a.SiteId == SiteDetails.SiteId).ToList();
                    Context.SiteAddresses.RemoveRange(siteAddressesToRemove);
                }
                else
                {
                    foreach (var item in SiteDetails.SiteShippingAddresses)
                    {
                        var existingSiteAddress = Context.SiteAddresses.FirstOrDefault(a => a.SiteId == SiteMaster.SiteId && a.Address == item.Address);
                        if (existingSiteAddress != null)
                        {
                            existingSiteAddress.Address = item.Address;
                            existingSiteAddress.SiteId = SiteMaster.SiteId;
                            Context.SiteAddresses.Update(existingSiteAddress);
                        }
                        else
                        {
                            var shippingAddress = new SiteAddress()
                            {
                                SiteId = SiteMaster.SiteId,
                                Address = item.Address,
                                IsDeleted = false,
                            };
                            Context.SiteAddresses.Add(shippingAddress);
                        }
                    }

                    var siteAddressIds = SiteDetails.SiteShippingAddresses.Select(a => a.Address).ToList();
                    var siteAddressesToRemove = Context.SiteAddresses.Where(a => a.SiteId == SiteDetails.SiteId && !siteAddressIds.Contains(a.Address)).ToList();
                    Context.SiteAddresses.RemoveRange(siteAddressesToRemove);
                }

                Context.SaveChanges();

                model.code = 200;
                model.message = "Site details successfully updated.";
            }
            catch (Exception ex)
            {
                model.code = 500;
                model.message = "An error occurred while updating site details: " + ex.Message;
            }
            return model;
        }

        public async Task<ApiResponseModel> ActiveDeactiveSite(Guid SiteId)
        {
            ApiResponseModel response = new ApiResponseModel();
            var siteData = await Context.Sites.FirstOrDefaultAsync(a => a.SiteId == SiteId);

            if (siteData == null)
            {
                response.code = 404;
                response.message = "Site not found.";
                return response;
            }


            var activeUsersCount = Context.Users
                .AsEnumerable()
                .Count(e => e.IsActive &&
                            e.SiteId != null &&
                            e.SiteId.Split(',')
                                .Select(id => Guid.TryParse(id, out var guid) ? guid : (Guid?)null)
                                .Contains(SiteId));


            if (activeUsersCount == 0)
            {
                if (siteData.IsActive)
                {
                    siteData.IsActive = false;
                    response.message = "Site " + siteData.SiteName + " is successfully deactivated.";
                }
                else
                {
                    siteData.IsActive = true;
                    response.message = "Site " + siteData.SiteName + " is successfully activated.";
                }

                Context.Sites.Update(siteData);
                await Context.SaveChangesAsync();

                response.code = 200;
                response.data = siteData;
            }
            else
            {
                response.message = "This site has active users, so it can't be deactivated.";
                response.code = 400;
            }

            return response;
        }


        public async Task<ApiResponseModel> DeleteSite(Guid SiteId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var siteDetails = await Context.Sites.FirstOrDefaultAsync(a => a.SiteId == SiteId);

                if (siteDetails == null)
                {
                    response.code = 404;
                    response.message = "Site not found.";
                    return response;
                }


                var activeUsersCount = Context.Users
                    .AsEnumerable()
                    .Count(e => e.IsActive && !e.IsDeleted &&
                                e.SiteId != null &&
                                e.SiteId.Split(',')
                                    .Select(id => Guid.TryParse(id, out var guid) ? guid : (Guid?)null)
                                    .Contains(SiteId));

                var purchaseRequests = await Context.PurchaseRequests.Where(b => b.SiteId == SiteId).ToListAsync();
                var inwardChallans = await Context.ItemInwords.Where(c => c.SiteId == SiteId).ToListAsync();
                var invoiceDetails = await Context.SupplierInvoices.Where(s => s.SiteId == SiteId).ToListAsync();

                if (!siteDetails.IsActive)
                {
                    if (activeUsersCount == 0)
                    {
                        if (invoiceDetails.Any())
                        {
                            response.code = 404;
                            response.message = "Invoice is created for this site.";
                        }
                        else
                        {
                            siteDetails.IsDeleted = true;
                            Context.Sites.Update(siteDetails);

                            foreach (var request in purchaseRequests)
                            {
                                request.IsDeleted = true;
                                Context.PurchaseRequests.Update(request);
                            }

                            foreach (var challan in inwardChallans)
                            {
                                challan.IsDeleted = true;
                                Context.ItemInwords.Update(challan);
                            }

                            await Context.SaveChangesAsync();

                            response.code = 200;
                            response.data = siteDetails;
                            response.message = "Site is deleted successfully";
                        }
                    }
                    else
                    {
                        response.message = "This site has active users, so it can't be deleted.";
                        response.code = 400;
                    }
                }
                else
                {
                    response.message = "Active site can't be deleted.";
                    response.code = 400;
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "An error occurred while processing your request.";
            }

            return response;
        }


        public async Task<IEnumerable<SiteMasterModel>> GetSiteNameList()
        {
            try
            {
                IEnumerable<SiteMasterModel> SiteName = Context.Sites.Where(e => e.IsActive == true).OrderBy(e => e.SiteName).ToList().Select(a => new SiteMasterModel
                {
                    SiteId = a.SiteId,
                    SiteName = a.SiteName,
                });
                return SiteName;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<SiteAddressModel>> GetSiteAddressList(Guid SiteId)
        {
            try
            {
                var data = await (from a in Context.SiteAddresses
                                  join b in Context.Sites on a.SiteId equals b.SiteId
                                  join c in Context.States on b.StateId equals c.StatesId
                                  where (a.SiteId == SiteId && a.IsDeleted != true)
                                  select new SiteAddressModel
                                  {
                                      Aid = a.Aid,
                                      SiteId = a.SiteId,
                                      Address = a.Address,
                                      IsDeleted = a.IsDeleted,
                                      StateCode = c.StateCode,
                                  }).ToListAsync();
                return data;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> AddSiteGroupDetails(SiteGroupModel GroupDetails)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var groupId = Guid.NewGuid();
                bool isGroupAlreadyExists = Context.GroupMasters.Any(x => x.GroupName == GroupDetails.GroupName);
                {
                    if (isGroupAlreadyExists == true)
                    {
                        response.message = "This group already exists.";
                        response.code = (int)HttpStatusCode.NotFound;
                    }
                    else
                    {
                        if (GroupDetails.GroupAddressList.Count > 0)
                        {
                            foreach (var siteId in GroupDetails.SiteIdList)
                            {
                                foreach (var item in GroupDetails.GroupAddressList)
                                {
                                    var groupModel = new GroupMaster()
                                    {
                                        GroupId = groupId,
                                        GroupName = GroupDetails.GroupName,
                                        SiteId = siteId.SiteId,
                                        GroupAddress = item.GroupAddress,
                                        CreatedOn = DateTime.Now,
                                    };
                                    Context.GroupMasters.Add(groupModel);
                                }
                            }
                        }
                        else
                        {
                            foreach (var siteId in GroupDetails.SiteIdList)
                            {
                                var groupModel = new GroupMaster()
                                {
                                    GroupId = groupId,
                                    GroupName = GroupDetails.GroupName,
                                    SiteId = siteId.SiteId,
                                    CreatedOn = DateTime.Now,
                                };
                                Context.GroupMasters.Add(groupModel);
                            }
                        }
                        await Context.SaveChangesAsync();
                        response.code = 200;
                        response.message = "Group is added successfully!";
                    }
                }
                return response;
            }
            catch (Exception)
            {
                throw;
            }
        }


        public async Task<IEnumerable<GroupMasterModel>> GetGroupNameListBySiteId(Guid siteId)
        {
            try
            {
                var groupList = await Context.GroupMasters
                    .Where(e => e.SiteId == siteId)
                    .GroupBy(a => new { a.GroupId, a.GroupName })
                    .Select(g => new GroupMasterModel
                    {
                        Id = g.First().Id,
                        GroupName = g.Key.GroupName,
                        GroupId = g.Key.GroupId,
                        SiteList = g.Select(s => new SiteNameList
                        {
                            SiteId = s.SiteId,
                        }).ToList()
                    })
                    .ToListAsync();

                return groupList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<SiteGroupModel>> GetGroupNameList()
        {
            try
            {
                var SiteGroupList = (from a in Context.GroupMasters
                                     group new { a } by new { a.GroupName, a.GroupId } into g
                                     select new SiteGroupModel
                                     {
                                         GroupName = g.Key.GroupName,
                                         GroupId = g.Key.GroupId,
                                     });
                return SiteGroupList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> DeleteSiteGroupDetails(Guid GroupId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var grouplist = Context.GroupMasters.Where(x => x.GroupId == GroupId).ToList();


                if (grouplist.Count > 0)
                {

                    var groupName = grouplist.FirstOrDefault()?.GroupName;


                    var checkgroup = Context.SupplierInvoices.Where(x => x.SiteGroup == groupName).ToList();

                    if (checkgroup.Count > 0)
                    {
                        response.code = 404;
                        response.message = "Invoice is created for this Group.";
                    }
                    else
                    {
                        foreach (var group in grouplist)
                        {
                            Context.GroupMasters.Remove(group);
                        }
                        await Context.SaveChangesAsync();
                        response.code = 200;
                        response.message = "Site group is deleted successfully.";
                    }
                }
                else
                {
                    response.code = 400;
                    response.message = "Site group is not found.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "There is some error in deleting site group.";
            }
            return response;
        }


        public async Task<SiteGroupModel> GetGroupDetailsByGroupName(string GroupName)
        {
            try
            {
                var groupDetails = await (from g in Context.GroupMasters
                                          join s in Context.Sites on g.SiteId equals s.SiteId
                                          where g.GroupName == GroupName
                                          select new SiteGroupModel
                                          {
                                              GroupName = g.GroupName,
                                              GroupId = g.GroupId,
                                              SiteId = g.SiteId,
                                              SiteName = s.SiteName,
                                          }).FirstOrDefaultAsync();
                if (groupDetails == null)
                {
                    return null;
                }
                var groupAddress = await (from a in Context.GroupMasters
                                          where a.GroupName == GroupName && !string.IsNullOrEmpty(a.GroupAddress)
                                          select new GroupAddressList
                                          {
                                              GroupAddress = a.GroupAddress,
                                          }).ToListAsync();

                groupDetails.GroupAddressList = groupAddress.Count > 0 ? groupAddress : null;

                return groupDetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<SiteGroupModel> GetGroupDetailsByGroupId(Guid GroupId)
        {
            try
            {
                var groupDetails = await (from g in Context.GroupMasters
                                          join s in Context.Sites on g.SiteId equals s.SiteId
                                          where g.GroupId == GroupId
                                          select new SiteGroupModel
                                          {
                                              GroupName = g.GroupName,
                                              GroupId = g.GroupId,
                                              SiteId = g.SiteId,
                                              SiteName = s.SiteName,
                                          }).FirstOrDefaultAsync();
                var groupAddress = await (from a in Context.GroupMasters
                                          where a.GroupId == GroupId && !string.IsNullOrEmpty(a.GroupAddress)
                                          select new GroupAddressList
                                          {
                                              GroupAddress = a.GroupAddress,
                                          }).ToListAsync();

                var SiteDetails = await (from a in Context.GroupMasters
                                         join b in Context.Sites on a.SiteId equals b.SiteId
                                         where a.GroupId == GroupId
                                         select new SiteNameList
                                         {
                                             SiteId = a.SiteId,
                                             SiteName = b.SiteName,
                                         }).ToListAsync();

                groupDetails.GroupAddressList = groupAddress.Count > 0 ? groupAddress : null;
                groupDetails.SiteIdList = SiteDetails;

                return groupDetails;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<ApiResponseModel> UpdateSiteGroupMaster(SiteGroupModel groupDetails)
        {
            ApiResponseModel model = new ApiResponseModel();
            try
            {
                var existingGroup = await Context.GroupMasters.AnyAsync(g => g.GroupId == groupDetails.GroupId);

                if (!existingGroup)
                {
                    model.code = 400;
                    model.message = "Group not found.";
                    return model;
                }

                var addressesToRemove = Context.GroupMasters
                        .Where(e => e.GroupId == groupDetails.GroupId)
                        .ToList();
                Context.GroupMasters.RemoveRange(addressesToRemove);

                foreach (var siteId in groupDetails.SiteIdList)
                {
                    foreach (var item in groupDetails.GroupAddressList)
                    {
                        var groupModel = new GroupMaster()
                        {
                            GroupId = groupDetails.GroupId,
                            GroupName = groupDetails.GroupName,
                            SiteId = siteId.SiteId,
                            GroupAddress = item.GroupAddress,
                            CreatedOn = DateTime.Now,
                        };
                        Context.GroupMasters.Add(groupModel);
                    }
                }

                await Context.SaveChangesAsync();
                model.code = 200;
                model.message = "Site group master updated successfully.";
            }
            catch (Exception ex)
            {
                model.code = 500;
                model.message = "An error occurred while updating site group details: " + ex.Message;
            }

            return model;
        }

        public async Task<IEnumerable<GroupMasterModel>> GetGroupNamesList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                var SiteGroupList = (from a in Context.GroupMasters
                                     select new
                                     {
                                         a.GroupName,
                                         a.GroupId,
                                         a.SiteId,
                                         a.CreatedOn
                                     })
                            .GroupBy(x => new { x.GroupName, x.GroupId })
                            .Select(g => new GroupMasterModel
                            {
                                GroupName = g.Key.GroupName,
                                GroupId = g.Key.GroupId,
                                SiteList = g.Select(x => new SiteNameList
                                {
                                    SiteId = x.SiteId,
                                }).Distinct().ToList(),
                                CreatedOn = g.Max(x => x.CreatedOn)
                            });

                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    SiteGroupList = SiteGroupList.Where(u =>
                        u.GroupName.ToLower().Contains(searchText));
                }


                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "Groupname":
                            SiteGroupList = SiteGroupList.Where(u => u.GroupName.ToLower().Contains(searchText));
                            break;
                        default:

                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {
                    SiteGroupList = SiteGroupList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending", StringComparison.OrdinalIgnoreCase) ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length).Trim();

                    switch (field.ToLower())
                    {
                        case "groupname":
                            SiteGroupList = sortOrder == "ascending"
                                ? SiteGroupList.OrderBy(u => u.GroupName)
                                : SiteGroupList.OrderByDescending(u => u.GroupName);
                            break;
                        case "createdon":
                            SiteGroupList = sortOrder == "ascending"
                                ? SiteGroupList.OrderBy(u => u.CreatedOn)
                                : SiteGroupList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:
                            break;
                    }
                }

                return await SiteGroupList.ToListAsync();
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
    }
}
