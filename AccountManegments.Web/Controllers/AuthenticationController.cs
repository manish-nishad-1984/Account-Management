using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManegments.Web.Helper;
using AccountManegments.Web.Models;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using System.Net;
using System.Security.Claims;
using AccountManagement.DBContext.Models.DataTableParameters;
using AccountManagement.DBContext.Models.ViewModels;
using AccountManagement.API;
using AccountManagement.DBContext.Models.ViewModels.FormMaster;
using AccountManagement.DBContext.Models.ViewModels.FormPermissionMaster;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Http;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;


namespace AccountManegments.Web.Controllers
{
    public class AuthenticationController : Controller
    {


        public AuthenticationController(WebAPI webAPI, APIServices aPIServices, IWebHostEnvironment environment)
        {
            WebAPI = webAPI;
            APIServices = aPIServices;
            Environment = environment;

        }
        public WebAPI WebAPI { get; }
        public APIServices APIServices { get; }
        public IWebHostEnvironment Environment { get; }
        public UserSession UserSession { get; }

        public IActionResult Index()
        {
            return View();
        }
        public async Task<JsonResult> GetCountrys()
        {

            try
            {
                List<CountryView> countries = new List<CountryView>();
                ApiResponseModel response = await APIServices.GetAsyncId(null, "MasterList/GetCountries");
                if (response.code == 200)
                {
                    countries = JsonConvert.DeserializeObject<List<CountryView>>(response.data.ToString());
                }
                return new JsonResult(countries);

            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<JsonResult> GetState(int StateId)
        {

            try
            {
                List<StateView> states = new List<StateView>();
                ApiResponseModel response = await APIServices.GetAsyncId(null, "MasterList/GetState?StateId=" + StateId);
                if (response.code == 200)
                {
                    states = JsonConvert.DeserializeObject<List<StateView>>(response.data.ToString());
                }
                return new JsonResult(states);

            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<JsonResult> GetCity(int CityId)
        {

            try
            {
                List<CityView> cities = new List<CityView>();
                ApiResponseModel response = await APIServices.GetAsyncId(null, "MasterList/GetCities?CityId=" + CityId);
                if (response.code == 200)
                {
                    cities = JsonConvert.DeserializeObject<List<CityView>>(response.data.ToString());
                }
                return new JsonResult(cities);

            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        [HttpGet]
        public IActionResult UserLogin()
        {

            if (Request.Cookies["UserName"] != null && Request.Cookies["Password"] != null)
            {
                ViewBag.UserName = (Request.Cookies["UserName"].ToString());
                var pwd = Request.Cookies["Password"].ToString();
                ViewBag.Password = pwd;
                ViewBag.chkRememberMe = true;

            }
            return View();
        }


        [HttpPost]
        public async Task<IActionResult> UserLogin(LoginRequest login)
        {
            try
            {
                ApiResponseModel responsemodel = await APIServices.PostAsync(login, "Authentication/Login");

                if (responsemodel.code != (int)HttpStatusCode.OK)
                {
                    TempData["ErrorMessage"] = responsemodel.message;

                    if (responsemodel.code == (int)HttpStatusCode.Forbidden)
                    {
                        return Ok(new { Message = responsemodel.message, Code = responsemodel.code });
                    }

                    return View(login);
                }


                var userLogin = new LoginResponseModel
                {
                    Data = JsonConvert.DeserializeObject<LoginView>(responsemodel.data.ToString())
                };

                if (userLogin.Data == null)
                {
                    TempData["ErrorMessage"] = "Invalid login data received.";
                    return View(login);
                }


                userLogin.Data.userSites ??= JsonConvert.DeserializeObject<List<UserSiteListModel>>(responsemodel.data["userSites"]?.ToString() ?? "[]");
                userLogin.Data.userCompany ??= JsonConvert.DeserializeObject<List<UserCompanyListModel>>(responsemodel.data["userCompany"]?.ToString() ?? "[]");


                var claims = new List<Claim>
        {
            new Claim("UserId", userLogin.Data.Id.ToString()),
            new Claim("FullName", userLogin.Data.FullName ?? ""),
            new Claim("UserName", userLogin.Data.UserName ?? ""),
            new Claim("Token", userLogin.Data.Token ?? "")
        };


                if (userLogin.Data.userSites.Any())
                {
                    var singleSite = userLogin.Data.userSites.First();
                    claims.Add(new Claim("SiteId", singleSite.SiteId.ToString()));
                    claims.Add(new Claim("SiteName", singleSite.SiteName ?? ""));
                    UserSession.SiteId = singleSite.SiteId.ToString();
                    UserSession.SiteName = singleSite.SiteName;
                }


                if (userLogin.Data.userCompany.Any())
                {
                    var singleCompany = userLogin.Data.userCompany.First();
                    claims.Add(new Claim("CompanyId", singleCompany.CompanyId.ToString())); // Corrected the typo
                    claims.Add(new Claim("CompanyName", singleCompany.CompanyName ?? ""));
                    UserSession.ComapnyId = singleCompany.CompanyId.ToString();
                    UserSession.CompanyName = singleCompany.CompanyName;
                }


                if (login.RememberMe)
                {
                    CookieOptions cookie = new CookieOptions { Expires = DateTime.UtcNow.AddDays(7) };
                    Response.Cookies.Append("UserName", login.UserName, cookie);
                    Response.Cookies.Append("Password", login.Password, cookie);
                }
                else
                {
                    Response.Cookies.Delete("UserName");
                    Response.Cookies.Delete("Password");
                }


                UserSession.FormPermisionData = userLogin.Data.FromPermissionData;
                UserSession.SiteData = userLogin.Data.userSites;
                UserSession.CompanyData = userLogin.Data.userCompany;


                var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
                var claimsPrincipal = new ClaimsPrincipal(claimsIdentity);
                await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, claimsPrincipal, new AuthenticationProperties
                {
                    IsPersistent = true, // 🔥 THIS IS THE MAIN FIX
                    ExpiresUtc = DateTime.UtcNow.AddHours(8),
                    AllowRefresh = true
                });

                return RedirectToAction("Index", "Home");
            }
            catch (Exception ex)
            {
                ViewBag.LoginError = "Login failed due to an unexpected error.";
                return View(login);
            }
        }



        [HttpPost]
        public async Task<IActionResult> Logout()
        {
            try
            {
                HttpContext.Session.Clear();
                await HttpContext.SignOutAsync();

            }
            catch (Exception ex)
            {

                throw ex;
            }
            return RedirectToAction("UserLogin");
        }
    }
}
