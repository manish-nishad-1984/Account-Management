using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.InvoiceMaster;
using AccountManagement.DBContext.Models.ViewModels.ItemInWord;
using AccountManagement.DBContext.Models.ViewModels.ItemMaster;
using AccountManagement.DBContext.Models.ViewModels.PurchaseOrder;
using AccountManagement.DBContext.Models.ViewModels.PurchaseRequest;
using AccountManagement.DBContext.Models.ViewModels.SupplierMaster;
using AccountManegments.Web.Helper;
using AccountManegments.Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using System.Diagnostics;

namespace AccountManegments.Web.Controllers
{
    [Authorize]
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        public WebAPI WebAPI { get; }
        public APIServices APIServices { get; }
        public HomeController(ILogger<HomeController> logger, WebAPI webAPI, APIServices aPIServices)
        {
            _logger = logger;

            WebAPI = webAPI;
            APIServices = aPIServices;
        }

        public async Task<IActionResult> Index(string searchText, string searchBy, string sortBy)
        {

            try
            {

                Guid? siteId = string.IsNullOrEmpty(UserSession.SiteId) ? null : new Guid(UserSession.SiteId);
                string apiUrl = $"PurchaseRequest/GetPurchaseRequestList?searchText={searchText}&searchBy={searchBy}&sortBy={sortBy}&siteId={siteId}";
                // API endpoint requires POST (not GET)
                ApiResponseModel res = await APIServices.PostAsync("", apiUrl);

                if (res.code == 200)
                {
                    List<PurchaseRequestModel> GetSiteList = JsonConvert.DeserializeObject<List<PurchaseRequestModel>>(res.data.ToString());

                    return View(GetSiteList.Where(e => e.IsApproved == false));
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve Purchase Request list." });
                }
            }
            catch (FormatException ex)
            {
                return BadRequest(new { Message = "Invalid SiteId format." });
            }


        }

        public async Task<IActionResult> PurchaseRequestList(Guid? SiteId, string SiteName)
        {
            try
            {
                UserSession.SiteId = SiteId.ToString();
                UserSession.SiteName = SiteId == null ? "All Site" : SiteName.ToString();

                Guid? siteId = string.IsNullOrEmpty(UserSession.SiteId) ? null : new Guid(UserSession.SiteId);
                string siteName = string.IsNullOrEmpty(UserSession.SiteName) ? null : new(UserSession.SiteName);
                return Ok();
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }


        public async Task<IActionResult> GetSupplierPendingDetailsList(Guid CompanyId)
        {
            try
            {
                ApiResponseModel res = await APIServices.GetAsync("", "SupplierInvoiceDetails/GetSupplierPendingDetailsList?CompanyId=" + CompanyId);

                if (res.code == 200)
                {
                    List<SupplierPendingDetailsModel> GetPendingList = JsonConvert.DeserializeObject<List<SupplierPendingDetailsModel>>(res.data.ToString());

                    return PartialView("~/Views/Home/_DashboardPaymentPartial.cshtml", GetPendingList.Where(e => e.TotalPending != 0));
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve Pending Invoice list." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }

        public IActionResult Privacy()
        {
            return View();
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }

        public IActionResult UnAuthorised()
        {
            return View();
        }

        public async Task<IActionResult> ItemListAction(string searchText, string searchBy, string sortBy)
        {
            try
            {

                string apiUrl = $"ItemMaster/GetItemList?searchText={searchText}&searchBy={searchBy}&sortBy={sortBy}";

                ApiResponseModel res = await APIServices.PostAsync("", apiUrl);

                if (res.code == 200)
                {
                    List<ItemMasterModel> GetItemList = JsonConvert.DeserializeObject<List<ItemMasterModel>>(res.data.ToString());
                    GetItemList = GetItemList.Where(a => a.IsApproved == false).ToList();

                    return PartialView("~/Views/Home/_DashboardItemList.cshtml", GetItemList);
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve user list." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }

        public async Task<IActionResult> PurchaseOrderListView(string searchText, string searchBy, string sortBy)
        {
            try
            {

                string siteIdString = UserSession.SiteId;
                Guid? SiteId = !string.IsNullOrEmpty(siteIdString) ? Guid.Parse(siteIdString) : (Guid?)null;
                string apiUrl = $"PurchaseOrder/GetPurchaseOrderList?searchText={searchText}&searchBy={searchBy}&sortBy={sortBy}";

                ApiResponseModel res = await APIServices.PostAsync("", apiUrl);

                if (res.code == 200)
                {
                    List<PurchaseOrderView> GetPOList = JsonConvert.DeserializeObject<List<PurchaseOrderView>>(res.data.ToString());
                    if (SiteId != null)
                    {
                        GetPOList = GetPOList.Where(a => a.SiteId == SiteId).ToList();
                    }
                    return PartialView("~/Views/Home/_DashboardPOList.cshtml", GetPOList);
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve user list." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }
        public async Task<IActionResult> SupplierListView(string searchText, string searchBy, string sortBy)
        {
            try
            {

                string apiUrl = $"SupplierMaster/GetAllSupplierList?searchText={searchText}&searchBy={searchBy}&sortBy={sortBy}";

                ApiResponseModel res = await APIServices.PostAsync("", apiUrl);

                if (res.code == 200)
                {
                    List<SupplierModel> GetSupplierList = JsonConvert.DeserializeObject<List<SupplierModel>>(res.data.ToString());
                    GetSupplierList = GetSupplierList.Where(a => a.IsApproved == false).ToList();
                    return PartialView("~/Views/Home/_DashboardSupplierListPartial.cshtml", GetSupplierList);
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve user list." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }
        public async Task<IActionResult> ItemInWordListView(string? searchText, string? searchBy, string? sortBy, Guid? SiteId)
        {
            try
            {
                if (SiteId != null)
                {
                    UserSession.SiteId = SiteId.ToString();
                }
                Guid? siteId = string.IsNullOrEmpty(UserSession.SiteId) ? null : new Guid(UserSession.SiteId);
                string apiUrl = $"ItemInWord/GetItemInWordList";
                InwardListRequestModel request = new InwardListRequestModel()
                {
                    itemname = searchText,
                    supplier = null,
                    startDate = null,
                    enddate = null,
                    sortBy = sortBy,
                    siteId = siteId
                };

                ApiResponseModel res = await APIServices.PostAsync(request, apiUrl);

                if (res.code == 200)
                {
                    List<ItemInWordModel> GetInwardList = JsonConvert.DeserializeObject<List<ItemInWordModel>>(res.data.ToString());
                    GetInwardList = GetInwardList.Where(a => a.IsApproved == false).ToList();
                    return PartialView("~/Views/Home/_DashboardInwardListPartial.cshtml", GetInwardList);
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve Item In Word list." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }
        [HttpPost]
        public async Task<IActionResult> PurchaseOrderIsApproved()
        {
            try
            {
                var isApprovedDetails = HttpContext.Request.Form["POIsApproved"];
                var POIdList = JsonConvert.DeserializeObject<POIsApprovedMasterModel>(isApprovedDetails);
                ApiResponseModel postuser = await APIServices.PostAsync(POIdList, "PurchaseOrder/PurchaseOrderIsApproved");
                if (postuser.code == 200)
                {
                    return Ok(new { Message = string.Format(postuser.message), Code = postuser.code });
                }
                else
                {
                    return Ok(new { Message = string.Format(postuser.message), Code = postuser.code });
                }
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IActionResult> SupplierInvoiceListAction(string searchText, string searchBy, string sortBy)
        {
            try
            {
                string siteIdString = UserSession.SiteId;
                Guid? SiteId = !string.IsNullOrEmpty(siteIdString) ? Guid.Parse(siteIdString) : (Guid?)null;

                string apiUrl = $"SupplierInvoice/GetSupplierInvoiceList?searchText={searchText}&searchBy={searchBy}&sortBy={sortBy}";

                ApiResponseModel res = await APIServices.PostAsync("", apiUrl);

                if (res.code == 200)
                {
                    SupplierInvoiceList GetInvoiceList = JsonConvert.DeserializeObject<SupplierInvoiceList>(res.data.ToString());

                    if (SiteId.HasValue)
                    {
                        GetInvoiceList.InvoiceList = GetInvoiceList.InvoiceList
                            .Where(invoice => invoice.SiteId == SiteId.Value)
                            .ToList();

                        GetInvoiceList.InvoiceItemList = GetInvoiceList.InvoiceItemList
                            .Where(item => GetInvoiceList.InvoiceList.Any(invoice => invoice.Id == item.Key))
                            .ToDictionary(
                                item => item.Key,
                                item => item.Value
                            );
                    }

                    return PartialView("~/Views/Home/_DashboardInvoiceList.cshtml", GetInvoiceList);
                }
                else
                {
                    return BadRequest(new { Message = "Failed to retrieve Supplier Invoice list." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest(new { Message = $"An error occurred: {ex.Message}" });
            }
        }


        [HttpPost]
        public async Task<IActionResult> InvoiceIsApproved()
        {
            try
            {
                var isApprovedDetails = HttpContext.Request.Form["InvoiceIsApproved"];
                var InvoiceIdList = JsonConvert.DeserializeObject<InvoiceIsApprovedMasterModel>(isApprovedDetails);
                ApiResponseModel postuser = await APIServices.PostAsync(InvoiceIdList, "SupplierInvoice/InvoiceIsApproved");
                if (postuser.code == 200)
                {
                    return Ok(new { Message = string.Format(postuser.message), Code = postuser.code });
                }
                else
                {
                    return Ok(new { Message = string.Format(postuser.message), Code = postuser.code });
                }
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        [HttpPost]
        public async Task<IActionResult> MutipleItemsIsApproved()
        {
            try
            {
                var isApprovedDetails = HttpContext.Request.Form["ItemIsApproved"];
                var ItemIdList = JsonConvert.DeserializeObject<ItemIsApprovedMasterModel>(isApprovedDetails);

                ApiResponseModel response = await APIServices.PostAsync(ItemIdList, "ItemMaster/MutipleItemsIsApproved");

                if (response.code == 200)
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
                else
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { Message = "An error occurred while processing your request.", Code = 500 });
            }
        }

        [HttpPost]
        public async Task<IActionResult> MultiplePurchaseRequestIsApproved()
        {
            try
            {
                var isApprovedDetails = HttpContext.Request.Form["PRIsApproved"];
                var PRIdList = JsonConvert.DeserializeObject<PRIsApprovedMasterModel>(isApprovedDetails);

                ApiResponseModel response = await APIServices.PostAsync(PRIdList, "PurchaseRequest/MultiplePurchaseRequestIsApproved");

                if (response.code == 200)
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
                else
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { Message = "An error occurred while processing your request.", Code = 500 });
            }
        }
        [HttpPost]
        public async Task<IActionResult> MultipleSupplierIsApproved()
        {
            try
            {
                var isApprovedDetails = HttpContext.Request.Form["SupplierIsApproved"];
                var SupplierList = JsonConvert.DeserializeObject<SupplierIsApprovedMasterModel>(isApprovedDetails);

                ApiResponseModel response = await APIServices.PostAsync(SupplierList, "SupplierMaster/MultipleSupplierIsApproved");

                if (response.code == 200)
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
                else
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { Message = "An error occurred while processing your request.", Code = 500 });
            }
        }
        [HttpPost]
        public async Task<IActionResult> MultipleInwardIsApproved()
        {
            try
            {
                var isApprovedDetails = HttpContext.Request.Form["InwardIsApproved"];
                var InwardList = JsonConvert.DeserializeObject<InwardIsApprovedMasterModel>(isApprovedDetails);

                ApiResponseModel response = await APIServices.PostAsync(InwardList, "ItemInWord/MultipleInwardIsApproved");

                if (response.code == 200)
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
                else
                {
                    return Ok(new { Message = response.message, Code = response.code });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { Message = "An error occurred while processing your request.", Code = 500 });
            }
        }
    }
}
