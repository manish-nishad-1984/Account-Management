using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.FormPermissionMaster;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Repository.FormPermissionMaster;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.EntityFrameworkCore;
using Microsoft.SqlServer.Server;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.FormPermissionMasterRepository
{
    public class FormPermissionMasterRepo : IFormPermissionMaster
    {
        public FormPermissionMasterRepo(DbaccManegmentContext context)
        {
            Context = context;
        }
        public DbaccManegmentContext Context { get; }




        public Task<IEnumerable<UserwiseFormPermissionModel>> GetUserwiseFormPermissionList()
        {
            throw new NotImplementedException();
        }

        public async Task<List<UserwiseFormPermissionModel>> GetUserwiseFormPermissionById(Guid UserId)
        {
            var UserData = new List<UserwiseFormPermissionModel>();
            var data = await (from e in Context.UserwiseFormPermissions.Where(x => x.UserId == UserId)
                              join r in Context.Users on e.UserId equals r.Id
                              join f in Context.Forms on e.FormId equals f.FormId
                              where f.IsActive == true
                              orderby f.OrderId ascending
                              select new UserwiseFormPermissionModel
                              {
                                  Id = e.Id,
                                  UserId = e.UserId,
                                  FormId = e.FormId,
                                  FormName = f.FormName,
                                  FullName = r.FirstName + " " + r.LastName,
                                  IsAddAllow = e.IsAddAllow,
                                  IsViewAllow = e.IsViewAllow,
                                  IsEditAllow = e.IsEditAllow,
                                  IsDeleteAllow = e.IsDeleteAllow,
                                  IsApproved = e.IsApproved,
                                  CreatedBy = e.Createdby,
                                  CreatedOn = e.CreatedOn

                              }).ToListAsync();


            if (data.Count != 0)
            {
                UserData.AddRange(data);
            }
            return UserData;
        }

        public async Task<ApiResponseModel> UpdateMultipleUserwiseFormPermission(List<UserwiseFormPermissionModel> UpdatedUserwiseFormPermissions)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                foreach (var updatedPermission in UpdatedUserwiseFormPermissions)
                {
                    var existingPermissions = await Context.UserwiseFormPermissions
                        .Where(rp => rp.UserId == updatedPermission.UserId && rp.FormId == updatedPermission.FormId)
                        .ToListAsync();

                    if (existingPermissions.Any())
                    {
                        foreach (var Item in existingPermissions)
                        {
                            Item.IsAddAllow = updatedPermission.IsAddAllow;
                            Item.IsViewAllow = updatedPermission.IsViewAllow;
                            Item.IsEditAllow = updatedPermission.IsEditAllow;
                            Item.IsDeleteAllow = updatedPermission.IsDeleteAllow;
                            Item.IsApproved = updatedPermission.IsApproved;
                            Item.Createdby = updatedPermission.UserId;
                            Item.CreatedOn = DateTime.Now;
                            Context.Update(Item);
                        }
                    }
                    else
                    {
                        response.code = 404;
                        response.message = $"Permissions with roleid {updatedPermission.UserId} and formid {updatedPermission.FormId} not found.";
                        return response;
                    }
                }

                await Context.SaveChangesAsync();
                response.code = 200;
                response.message = "Userwise permissions successfully updated.";
            }
            catch (Exception ex)
            {
                response.code = 400;
                response.message = "Error updating userwise Permissions";
            }
            return response;
        }
    }
}

