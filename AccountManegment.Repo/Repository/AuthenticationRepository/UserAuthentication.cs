using AccountManagement.API;
using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.DataTableParameters;
using AccountManagement.DBContext.Models.ViewModels.FormPermissionMaster;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Interfaces.Authentication;
using AccountManegments.Web.Models;
using Azure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using System;
using System.Collections.Generic;
using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Linq.Expressions;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Threading.Tasks.Dataflow;
#nullable disable
namespace AccountManagement.Repository.Repository.AuthenticationRepository
{
    public class UserAuthentication : IAuthentication
    {
        public UserAuthentication(DbaccManegmentContext context, IConfiguration configuration)
        {
            Context = context;
            Configuration = configuration;
        }

        public DbaccManegmentContext Context { get; }
        public IConfiguration Configuration { get; }

        public async Task<UserResponceModel> ActiveDeactiveUsers(Guid UserId)
        {
            UserResponceModel response = new UserResponceModel();

            var GetUserdta = Context.Users.FirstOrDefault(a => a.Id == UserId);

            if (GetUserdta == null)
            {
                response.Message = "User not found.";
                response.Code = 404;
                return response;
            }


            var userSiteIds = GetUserdta.SiteId?
                              .Split(',')
                              .Select(id => Guid.TryParse(id, out var guid) ? guid : (Guid?)null)
                              .Where(guid => guid.HasValue)
                              .Select(guid => guid.Value)
                              .ToList();

            if (userSiteIds == null || !userSiteIds.Any())
            {
                response.Message = "No valid SiteId associated with the user.";
                response.Code = 400;
                return response;
            }


            var GetSite = Context.Sites.FirstOrDefault(e => userSiteIds.Contains(e.SiteId) && e.IsDeleted == false);

            if (GetSite != null)
            {
                if (GetSite.IsActive)
                {

                    GetUserdta.IsActive = !GetUserdta.IsActive;
                    Context.Users.Update(GetUserdta);
                    await Context.SaveChangesAsync();

                    response.Code = 200;
                    response.Data = GetUserdta;
                    response.Message = $"User {GetUserdta.UserName} is {(GetUserdta.IsActive ? "active" : "deactive")} successfully";
                }
                else
                {
                    response.Message = "This user's site is inactive.";
                    response.Code = 400;
                }
            }
            else
            {
                response.Message = "This user's site is deleted.";
                response.Code = 400;
            }

            return response;
        }

        public async Task<UserResponceModel> CreateUser(UserViewModel CreateUser)
        {
            UserResponceModel response = new UserResponceModel();

            try
            {
                bool isEmailAlreadyExists = Context.Users.Any(x => x.Email == CreateUser.Email || x.UserName == CreateUser.UserName);

                if (isEmailAlreadyExists)
                {
                    response.Message = "User with this username or email already exists";
                    response.Code = (int)HttpStatusCode.Conflict;
                }
                else
                {
                    var model = new User()
                    {
                        Id = Guid.NewGuid(),
                        FirstName = CreateUser.FirstName,
                        LastName = CreateUser.LastName,
                        UserName = CreateUser.UserName,
                        Email = CreateUser.Email,
                        PhoneNo = CreateUser.PhoneNo,
                        Password = CreateUser.Password,
                        IsActive = true,
                        SiteId = CreateUser.SiteId,
                        CompanyId = CreateUser.CompanyId,
                        IsDeleted = false,
                        CreatedBy = CreateUser.CreatedBy,
                        CreatedOn = DateTime.Now,
                    };

                    Context.Users.Add(model);


                    var Forms = Context.Forms.ToList();

                    foreach (var form in Forms)
                    {
                        var UserwisePermission = new UserwiseFormPermission()
                        {

                            UserId = model.Id,
                            FormId = form.FormId,
                            IsAddAllow = true,
                            IsViewAllow = true,
                            IsEditAllow = true,
                            IsDeleteAllow = true,
                            IsApproved = true,
                            Createdby = model.CreatedBy,
                            CreatedOn = DateTime.Now,
                        };
                        Context.UserwiseFormPermissions.Add(UserwisePermission);
                    }


                    Context.SaveChanges();

                    response.Code = (int)HttpStatusCode.OK;
                    response.Message = "User created successfully";
                }
            }
            catch (Exception ex)
            {
                response.Code = (int)HttpStatusCode.InternalServerError;
                response.Message = "An error occurred while creating the user";
            }

            return response;
        }

        public async Task<UserResponceModel> DeleteUserDetails(Guid UserId)
        {
            UserResponceModel response = new UserResponceModel();
            var GetUserdata = Context.Users.Where(a => a.Id == UserId).FirstOrDefault();


            if (GetUserdata != null && GetUserdata.IsActive == false)
            {
                GetUserdata.IsDeleted = true;
                Context.Users.Update(GetUserdata);
                Context.SaveChanges();
                response.Code = 200;
                response.Data = GetUserdata;
                response.Message = "User is deleted successfully";
            }
            else
            {
                response.Message = "Active user can't delete.";
                response.Code = 400;
            }
            return response;
        }

        public string GenerateToken(LoginRequest model)
        {
            var claims = new List<Claim>();
            claims.Add(new Claim(JwtRegisteredClaimNames.Sub, model.UserName));
            claims.Add(new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()));
            claims.Add(new Claim("UserName", model.UserName));
            var securitykey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Configuration["Jwt:Key"]));
            var credentials = new SigningCredentials(securitykey, SecurityAlgorithms.HmacSha256);
            var token = new JwtSecurityToken(Configuration["Jwt:Issuer"], Configuration["Jwt:Audience"], claims: claims.ToArray(),
                expires: DateTime.Now.AddHours(8), signingCredentials: credentials);
            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        public async Task<LoginView> GetUserById(Guid UserId)
        {
            LoginView Userdata = new LoginView();
            try
            {
                var SiteList = Context.Sites.ToList();
                var CompanyList = Context.Companies.ToList();
                Userdata = (from e in Context.Users.Where(x => x.Id == UserId)

                            select new
                            {
                                e.Id,
                                e.UserName,
                                e.FirstName,
                                e.LastName,
                                e.Email,
                                e.Password,
                                e.IsActive,
                                e.PhoneNo,
                                e.SiteId,
                                e.CompanyId,

                            }).AsEnumerable().Select(user => new LoginView
                            {
                                Id = user.Id,
                                UserName = user.UserName,
                                FirstName = user.FirstName,
                                LastName = user.LastName,
                                Email = user.Email,
                                Password = user.Password,
                                IsActive = user.IsActive,
                                PhoneNo = user.PhoneNo,
                                SiteId = user.SiteId,
                                CompanyId = user.CompanyId,

                                // Map SiteId GUIDs to SiteNames
                                SiteName = user.SiteId != null
                        ? string.Join(", ", user.SiteId.Split(',')
                            .Select(guid => SiteList.FirstOrDefault(s => s.SiteId.ToString() == guid)?.SiteName)
                            .Where(name => !string.IsNullOrEmpty(name)))
                        : null,
                                CompanyName = user.CompanyId != null
                        ? string.Join(", ", user.CompanyId.Split(',')
                            .Select(guid => CompanyList.FirstOrDefault(s => s.CompanyId.ToString() == guid)?.CompanyName)
                            .Where(name => !string.IsNullOrEmpty(name)))
                        : null,
                            }).First();
                return Userdata;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<LoginView>> GetUsersList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                var SiteList = Context.Sites.ToList();
                var CompanyList = Context.Companies.ToList();

                IEnumerable<LoginView> userList = Context.Users
                    .Where(e => e.IsDeleted == false)
                    .Select(e => new
                    {
                        e.Id,
                        e.FirstName,
                        e.LastName,
                        e.UserName,
                        e.Email,
                        e.PhoneNo,
                        e.IsActive,
                        e.SiteId,
                        e.CompanyId,
                        e.CreatedOn
                    })
                    .AsEnumerable()
                    .Select(user => new LoginView
                    {
                        Id = user.Id,
                        FirstName = user.FirstName,
                        LastName = user.LastName,
                        UserName = user.UserName,
                        Email = user.Email,
                        PhoneNo = user.PhoneNo,
                        IsActive = user.IsActive,
                        SiteId = user.SiteId,
                        CompanyId = user.CompanyId,
                        CreatedOn = user.CreatedOn,

                        SiteName = user.SiteId != null
                            ? string.Join(", ", user.SiteId.Split(',')
                                .Select(guid => SiteList.FirstOrDefault(s => s.SiteId.ToString() == guid)?.SiteName)
                                .Where(name => !string.IsNullOrEmpty(name)))
                            : null,
                        CompanyName = user.CompanyId != null
                            ? string.Join(", ", user.CompanyId.Split(',')
                                .Select(guid => CompanyList.FirstOrDefault(s => s.CompanyId.ToString() == guid)?.CompanyName)
                                .Where(name => !string.IsNullOrEmpty(name)))
                            : null,
                    });




                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    userList = userList.Where(u =>
                        u.UserName.ToLower().Contains(searchText) ||
                        u.Email.ToLower().Contains(searchText) ||
                        u.PhoneNo.ToLower().Contains(searchText) ||
                        u.FirstName.ToLower().Contains(searchText) ||
                        u.LastName.ToLower().Contains(searchText)
                    );
                }

                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "username":
                            userList = userList.Where(u => u.UserName.ToLower().Contains(searchText));
                            break;
                        case "email":
                            userList = userList.Where(u => u.Email.ToLower().Contains(searchText));
                            break;
                        case "phone":
                            userList = userList.Where(u => u.PhoneNo.ToLower().Contains(searchText));
                            break;
                        default:
                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {
                    userList = userList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "username":
                            userList = sortOrder == "ascending"
                                ? userList.OrderBy(u => u.UserName)
                                : userList.OrderByDescending(u => u.UserName);
                            break;
                        case "firstname":
                            userList = sortOrder == "ascending"
                                ? userList.OrderBy(u => u.FirstName)
                                : userList.OrderByDescending(u => u.FirstName);
                            break;
                        case "createdon":
                            userList = sortOrder == "ascending"
                                ? userList.OrderBy(u => u.CreatedOn)
                                : userList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:
                            break;
                    }
                }

                return userList.ToList();
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<LoginResponseModel> LoginUser(LoginRequest loginRequest)
        {
            LoginResponseModel response = new LoginResponseModel();
            try
            {
                var tblUser = await (from u in Context.Users
                                     where u.UserName == loginRequest.UserName
                                     select new
                                     {
                                         User = u,
                                     }).FirstOrDefaultAsync();

                if (tblUser == null)
                {
                    response.Message = "User does not exist";
                    response.Code = (int)HttpStatusCode.NotFound;
                    return response;
                }

                if (!tblUser.User.IsActive)
                {
                    response.Code = (int)HttpStatusCode.Forbidden;
                    response.Message = "Your account is inactive. Please contact your administrator.";
                    return response;
                }

                if (tblUser.User.Password != loginRequest.Password)
                {
                    response.Message = "Your password is incorrect";
                    return response;
                }

                var authToken = GenerateToken(new LoginRequest { UserName = tblUser.User.UserName, Password = tblUser.User.Password });

                LoginView userModel = new LoginView
                {
                    UserName = tblUser.User.UserName,
                    Id = tblUser.User.Id,
                    FullName = $"{tblUser.User.FirstName} {tblUser.User.LastName}",
                    FirstName = tblUser.User.FirstName,
                    userSites = new List<UserSiteListModel>(),
                    userCompany = new List<UserCompanyListModel>(),
                    Token = authToken
                };

                bool userFormPermissionExists = await Context.UserwiseFormPermissions.AnyAsync(e => e.UserId == userModel.Id);
                if (userFormPermissionExists)
                {
                    userModel.FromPermissionData = await (from rfp in Context.UserwiseFormPermissions
                                                          join f in Context.Forms on rfp.FormId equals f.FormId
                                                          where rfp.UserId == userModel.Id && f.IsActive
                                                          orderby f.OrderId
                                                          select new FromPermission
                                                          {
                                                              FormName = f.FormName,
                                                              GroupName = f.FormGroup,
                                                              Controller = f.Controller,
                                                              Action = f.Action,
                                                              Add = rfp.IsAddAllow,
                                                              View = rfp.IsViewAllow,
                                                              Edit = rfp.IsEditAllow,
                                                              Delete = rfp.IsDeleteAllow,
                                                              IsApproved = rfp.IsApproved,
                                                          }).ToListAsync();

                    var siteIds = string.IsNullOrEmpty(tblUser.User.SiteId)
                        ? new List<Guid>()
                        : tblUser.User.SiteId.Split(',')
                            .Select(id => Guid.TryParse(id, out var guid) ? guid : (Guid?)null)
                            .Where(guid => guid.HasValue)
                            .Select(guid => guid.Value)
                            .ToList();

                    if (siteIds.Any())
                    {
                        userModel.userSites = await (from s in Context.Sites
                                                     where siteIds.Contains(s.SiteId)
                                                     orderby s.SiteName
                                                     select new UserSiteListModel
                                                     {
                                                         SiteId = s.SiteId,
                                                         SiteName = s.SiteName,
                                                     }).ToListAsync();
                    }
                    else
                    {
                        userModel.userSites = new List<UserSiteListModel>();
                    }

                    var companyIds = string.IsNullOrEmpty(tblUser.User.CompanyId)
                        ? new List<Guid>()
                        : tblUser.User.CompanyId.Split(',')
                            .Select(id => Guid.TryParse(id, out var guid) ? guid : (Guid?)null)
                            .Where(guid => guid.HasValue)
                            .Select(guid => guid.Value)
                            .ToList();

                    if (companyIds.Any())
                    {
                        userModel.userCompany = await (from s in Context.Companies
                                                       where companyIds.Contains(s.CompanyId)
                                                       orderby s.CompanyName
                                                       select new UserCompanyListModel
                                                       {
                                                           CompanyId = s.CompanyId,
                                                           CompanyName = s.CompanyName,
                                                       }).ToListAsync();
                    }
                    else
                    {
                        userModel.userCompany = new List<UserCompanyListModel>();
                    }

                }

                response.Data = userModel;
                response.Code = (int)HttpStatusCode.OK;
            }
            catch (Exception ex)
            {
                response.Message = "An error occurred while processing your request.";
                response.Code = (int)HttpStatusCode.InternalServerError;
            }

            return response;
        }




        public async Task<UserResponceModel> UpdateUserDetails(UserViewModel UpdateUser)
        {
            UserResponceModel response = new UserResponceModel();
            try
            {
                var Userdata = await Context.Users.FirstOrDefaultAsync(a => a.Id == UpdateUser.Id);
                if (Userdata != null)
                {
                    Userdata.Id = UpdateUser.Id;
                    Userdata.FirstName = UpdateUser.FirstName;
                    Userdata.LastName = UpdateUser.LastName;
                    Userdata.UserName = UpdateUser.UserName;
                    Userdata.Password = UpdateUser.Password;
                    Userdata.Email = UpdateUser.Email;
                    Userdata.PhoneNo = UpdateUser.PhoneNo;
                    Userdata.PhoneNo = UpdateUser.PhoneNo;
                    Userdata.SiteId = UpdateUser.SiteId;
                    Userdata.CompanyId = UpdateUser.CompanyId;
                    Context.Users.Update(Userdata);
                    Context.SaveChanges();
                    response.Code = (int)HttpStatusCode.OK;
                    response.Message = "User data updated successfully";
                }
                else
                {
                    response.Code = 400;
                    response.Message = "Error in updated user data";
                }
            }
            catch (Exception ex)
            {
                response.Code = 500;
                response.Message = "An error occurred while updating user data:" + ex;
            }
            return response;
        }
    }
}
