using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.InvoiceMaster;
using AccountManagement.DBContext.Models.ViewModels.ItemInWord;
using AccountManagement.DBContext.Models.ViewModels.PurchaseOrder;
using AccountManagement.DBContext.Models.ViewModels.PurchaseRequest;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManegments.Web.Helper;
using AccountManegments.Web.Models;
using Aspose.Pdf.Operators;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json;
using ClosedXML.Excel;

namespace AccountManegments.Web.Controllers
{
    [Authorize]
    public class ItemInWordController : Controller
    {
        public ItemInWordController(WebAPI webAPI, APIServices aPIServices, IWebHostEnvironment environment, UserSession userSession)
        {
            WebAPI = webAPI;
            APIServices = aPIServices;
            Environment = environment;
            UserSession = userSession;
        }

        public WebAPI WebAPI { get; }
        public APIServices APIServices { get; }
        public IWebHostEnvironment Environment { get; }
        public UserSession UserSession { get; }

        [FormPermissionAttribute("Inward Challan-View")]
        public IActionResult ItemInWord()
        {
            return View();
        }
        [FormPermissionAttribute("Inward Challan-View")]
        [HttpGet]
        public async Task<IActionResult> ItemInWordListAction(string? supplier, string? itemname, DateTime? startDate, DateTime? enddate, string? sortBy, Guid? SiteId)
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
                    itemname = itemname,
                    supplier = supplier,
                    startDate = startDate,
                    enddate = enddate,
                    sortBy = sortBy,
                    siteId = siteId
                };

                ApiResponseModel res = await APIServices.PostAsync(request, apiUrl);

                if (res.code == 200)
                {
                    List<ItemInWordModel> GetSiteList = JsonConvert.DeserializeObject<List<ItemInWordModel>>(res.data.ToString());

                    return PartialView("~/Views/ItemInWord/_ItemInWordPartial.cshtml", GetSiteList);
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

        [FormPermissionAttribute("Inward Challan-View")]
        [HttpGet]
        public async Task<IActionResult> ExportItemInWordCsv(string? supplier, string? itemname, DateTime? startDate, DateTime? enddate, string? sortBy, Guid? SiteId)
        {
            try
            {
                Guid? siteId = string.IsNullOrEmpty(UserSession.SiteId) ? null : new Guid(UserSession.SiteId);
                var request = new InwardListRequestModel
                {
                    itemname = itemname,
                    supplier = supplier,
                    startDate = startDate,
                    enddate = enddate,
                    sortBy = sortBy,
                    siteId = siteId
                };

                ApiResponseModel res = await APIServices.PostAsync(request, "ItemInWord/GetItemInWordList");
                if (res.code != 200)
                {
                    return BadRequest("Failed to retrieve data for export.");
                }

                if (res.data == null)
                {
                    // no data returned from API - return header-only CSV
                    var emptySb = new System.Text.StringBuilder();
                    emptySb.AppendLine("Item,Date,Quantity,Unit,Site,Supplier,InvoiceNo,VehicleNumber,ReceiverName,IsApproved");
                    var emptyBytes = System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(emptySb.ToString())).ToArray();
                    var emptyFile = $"ItemInWordExport_{DateTime.Now:yyyyMMdd_HHmmss}.csv";
                    return File(emptyBytes, "text/csv", emptyFile);
                }

                string jsonData;
                // res.data might be JArray/JObject or a string
                if (res.data is string)
                    jsonData = res.data as string;
                else
                    jsonData = JsonConvert.SerializeObject(res.data);

                var list = JsonConvert.DeserializeObject<List<ItemInWordModel>>(jsonData ?? "[]");
                var sb = new System.Text.StringBuilder();

                // CSV Header
                sb.AppendLine("Item,Date,Quantity,Unit,Site,Supplier,InvoiceNo,VehicleNumber,ReceiverName,IsApproved");

                foreach (var r in list)
                {
                    string date;
                    if (r.Date is DateTime dt && dt != default(DateTime))
                    {
                        date = dt.ToString("yyyy-MM-dd");
                    }
                    else
                    {
                        date = string.Empty;
                    }
                    var unit = r.UnitName ?? string.Empty;
                    var site = r.SiteName ?? string.Empty;
                    var supplierName = r.SupplierName ?? string.Empty;
                    var invoice = r.InvoiceNo ?? string.Empty;
                    var vehicle = r.VehicleNumber ?? string.Empty;
                    var receiver = r.ReceiverName ?? string.Empty;
                    var isApproved = r.IsApproved.HasValue && r.IsApproved.Value ? "Yes" : "No";

                    // Escape commas and quotes
                    string Escape(string s) => string.IsNullOrEmpty(s) ? "" : '"' + s.Replace("\"", "\"\"") + '"';

                    sb.AppendLine(string.Join(",", new[] {
                        Escape(r.Item ?? string.Empty),
                        Escape(date),
                        Escape(r.Quantity.ToString()),
                        Escape(unit),
                        Escape(site),
                        Escape(supplierName),
                        Escape(invoice),
                        Escape(vehicle),
                        Escape(receiver),
                        Escape(isApproved)
                    }));
                }

                var csvBytes = System.Text.Encoding.UTF8.GetPreamble().Concat(System.Text.Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
                var fileName = $"ItemInWordExport_{DateTime.Now:yyyyMMdd_HHmmss}.csv";
                return File(csvBytes, "text/csv", fileName);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }

        }

        [FormPermissionAttribute("Inward Challan-Add")]
        [HttpPost]
        public async Task<IActionResult> AddItemInWordDetails(ItemInWordRequestModel ItemInWordDetails)
        {
            try
            {
                var path = Environment.WebRootPath;
                var filepath = "Content/InWordDocument/" + ItemInWordDetails.DocumentName.FileName;
                var fullpath = Path.Combine(path, filepath);
                UploadFile(ItemInWordDetails.DocumentName, fullpath);
                var ItemInword = new ItemInWordModel()
                {
                    InwordId = Guid.NewGuid(),
                    SiteId = ItemInWordDetails.SiteId,
                    ItemId = ItemInWordDetails.ItemId,
                    Item = ItemInWordDetails.Item,
                    UnitTypeId = ItemInWordDetails.UnitTypeId,
                    Quantity = ItemInWordDetails.Quantity,
                    DocumentName = ItemInWordDetails.DocumentName.FileName,
                    CreatedBy = ItemInWordDetails.CreatedBy,
                    ReceiverName = ItemInWordDetails.ReceiverName,
                    VehicleNumber = ItemInWordDetails.VehicleNumber,
                    Date = DateTime.Now,
                    CreatedOn = DateTime.Now,
                    IsApproved = false,
                    IsDeleted = false,
                    InvoiceNo = ItemInWordDetails.InvoiceNo
                };
                var postuser = await APIServices.PostAsync(ItemInword, "ItemInWord/AddItemInWordDetails");
                if (postuser.code == 200)
                {
                    return Ok(new { Massage = postuser.message, Code = postuser.code });
                }
                else
                {
                    return Ok(new { Massage = "Something wrong!", Code = postuser.code }); ;
                }
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public void UploadFile(IFormFile ImageFile, string ImagePath)
        {
            FileStream stream = new FileStream(ImagePath, FileMode.Create);
            ImageFile.CopyTo(stream);
        }

        [HttpPost]
        public async Task<IActionResult> DeleteItemInWord(Guid InwordId)
        {
            try
            {
                ApiResponseModel postuser = await APIServices.PostAsync("", "ItemInWord/DeleteItemInWord?InwordId=" + InwordId);
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
        [FormPermissionAttribute("Inward Challan-View")]
        [HttpGet]
        public async Task<JsonResult> DisplayItemInWordDetails(Guid InwordId)
        {
            try
            {
                ItemInWordMasterView ItemInWordDetails = new ItemInWordMasterView();
                ApiResponseModel res = await APIServices.GetAsync("", "ItemInWord/GetItemInWordtDetailsById?InwordId=" + InwordId);
                if (res.code == 200)
                {
                    ItemInWordDetails = JsonConvert.DeserializeObject<ItemInWordMasterView>(res.data.ToString());

                }
                return new JsonResult(ItemInWordDetails);
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        [FormPermissionAttribute("Inward Challan-Edit")]
        [HttpPost]
        public async Task<IActionResult> ItemInWordIsApproved(Guid InwordId)
        {
            try
            {

                ApiResponseModel postuser = await APIServices.PostAsync("", "ItemInWord/ItemInWordIsApproved?InwordId=" + InwordId);
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
        public async Task<IActionResult> UpdateItemInWordDetails()
        {
            try
            {
                var ItemInWord = HttpContext.Request.Form["ITEMINWORD"];
                var ItemInWordDetails = JsonConvert.DeserializeObject<ItemInWordModel>(ItemInWord);
                ApiResponseModel postUser = await APIServices.PostAsync(ItemInWordDetails, "ItemInWord/UpdateItemInWordDetails");
                if (postUser.code == 200)
                {
                    return Ok(new { Message = postUser.message, Code = postUser.code });
                }
                else
                {
                    return Ok(new { Message = string.Format(postUser.message), Code = postUser.code });
                }
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        [FormPermissionAttribute("Inward Challan-Add")]
        [HttpPost]
        public async Task<IActionResult> InsertMultipleItemInWordDetail(List<IFormFile> DocDetails)
        {
            try
            {
                bool isApproved = UserSession.FormPermisionData.Any(a => a.FormName == "Inward Challan" && (a.IsApproved == true));
                var inWordDetails = HttpContext.Request.Form["InWordsDetails"];
                var InsertDetails = JsonConvert.DeserializeObject<ItemInWordMasterView>(inWordDetails);

                List<ItemInWordDocumentModel> documentList = new List<ItemInWordDocumentModel>();

                if (DocDetails != null && DocDetails.Count > 0)
                {
                    foreach (var file in DocDetails)
                    {
                        var fileName = Guid.NewGuid() + "_" + file.FileName;
                        var path = Environment.WebRootPath;
                        var filepath = "Content/InWordDocument/" + fileName;
                        var fullpath = Path.Combine(path, filepath);
                        UploadFile(file, fullpath);

                        var document = new ItemInWordDocumentModel
                        {
                            DocumentName = fileName,
                        };
                        documentList.Add(document);
                    }
                }

                var ItemInwordDetails = new ItemInWordMasterView()
                {
                    InwordId = Guid.NewGuid(),
                    SiteId = InsertDetails.SiteId,
                    ItemId = InsertDetails.ItemId,
                    Item = InsertDetails.Item,
                    UnitTypeId = InsertDetails.UnitTypeId,
                    Quantity = InsertDetails.Quantity,
                    CreatedBy = InsertDetails.CreatedBy,
                    ReceiverName = InsertDetails.ReceiverName,
                    VehicleNumber = InsertDetails.VehicleNumber,
                    Date = InsertDetails.Date,
                    CreatedOn = DateTime.Now,
                    IsApproved = isApproved,
                    DocumentLists = documentList,
                    SupplierId = InsertDetails.SupplierId,
                    InwardInvoiceNo = InsertDetails.InwardInvoiceNo
                };

                ApiResponseModel postuser = await APIServices.PostAsync(ItemInwordDetails, "ItemInWord/InsertMultipleItemInWordDetails");

                if (postuser.code == 200)
                {
                    return Ok(new { Message = postuser.message, Code = postuser.code });
                }
                else
                {
                    return Ok(new { Message = postuser.message, Code = postuser.code });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }

        public async Task<IActionResult> UpdatetMultipleItemInWordDetails(List<IFormFile> DocDetails)
        {
            try
            {
                var inWordDetails = HttpContext.Request.Form["UpdateItemInWord"];
                var UpdateDetails = JsonConvert.DeserializeObject<ItemInWordMasterView>(inWordDetails);

                List<ItemInWordDocumentModel> documentList = new List<ItemInWordDocumentModel>();

                if (DocDetails != null && DocDetails.Count > 0)
                {
                    foreach (var file in DocDetails)
                    {
                        var fileName = Guid.NewGuid() + "_" + file.FileName;
                        var path = Environment.WebRootPath;
                        var filepath = "Content/InWordDocument/" + fileName;
                        var fullpath = Path.Combine(path, filepath);
                        UploadFile(file, fullpath);

                        var document = new ItemInWordDocumentModel
                        {
                            DocumentName = fileName,
                        };
                        documentList.Add(document);
                    }
                }

                var ItemInwordDetails = new ItemInWordMasterView()
                {
                    InwordId = UpdateDetails.InwordId,
                    ItemId = UpdateDetails.ItemId,
                    Item = UpdateDetails.Item,
                    UnitTypeId = UpdateDetails.UnitTypeId,
                    Quantity = UpdateDetails.Quantity,
                    ReceiverName = UpdateDetails.ReceiverName,
                    VehicleNumber = UpdateDetails.VehicleNumber,
                    Date = UpdateDetails.Date,
                    DocumentName = UpdateDetails.DocumentName,
                    DocumentLists = documentList,
                    SiteId = UpdateDetails.SiteId,
                    SupplierId = UpdateDetails.SupplierId,
                    InwardInvoiceNo = UpdateDetails.InwardInvoiceNo
                };

                ApiResponseModel postuser = await APIServices.PostAsync(ItemInwordDetails, "ItemInWord/UpdatetMultipleItemInWordDetails");

                if (postuser.code == 200)
                {
                    return Ok(new { Message = postuser.message, Code = postuser.code });
                }
                else
                {
                    return Ok(new { Message = postuser.message, Code = postuser.code });
                }
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { message = ex.Message });
            }
        }
    }
}
