using AccountManagement.DBContext.Models.API;
using AccountManegments.Web.Models;
using Newtonsoft.Json;
using System.Net.Http.Headers;
using System.Text;

namespace AccountManegments.Web.Helper
{
    public class APIServices
    {

        public APIServices(WebAPI webAPI, IWebHostEnvironment environment, UserSession userSession, IHttpContextAccessor httpContext)
        {
            WebAPI = webAPI;
            Environment = environment;
            UserSession = userSession;
            HttpContext = httpContext;

            if (HttpContext.HttpContext != null && HttpContext.HttpContext.User.Identity.IsAuthenticated)
                Token = UserSession.Token;
        }
        private string Token { get; set; }

        public WebAPI WebAPI { get; }
        public IWebHostEnvironment Environment { get; }
        public UserSession UserSession { get; }
        public IHttpContextAccessor HttpContext { get; }

        public async Task<ApiResponseModel> GetAsync(dynamic id, string endpoint)
        {
            var model = new ApiResponseModel();

            try
            {
                HttpClient clients = WebAPI.Initil();
                var url = $"{clients.BaseAddress}{endpoint}";

                if (id != null)
                    url = $"{url}{id}";
                using var httpClientHandler = new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                };

                using var client = new HttpClient(httpClientHandler)
                {
                    Timeout = TimeSpan.FromMinutes(30)
                };

                if (!string.IsNullOrWhiteSpace(Token))
                    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);

                var response = await client.GetAsync(url);
                var responseContent = await response.Content.ReadAsStringAsync();
                var obj = JsonConvert.DeserializeObject<object>(responseContent);

                try
                {
                    model = JsonConvert.DeserializeObject<ApiResponseModel>(responseContent);
                }
                catch
                {
                    // fallback: wrap raw response
                    model = new ApiResponseModel { data = null, message = responseContent, code = (int)response.StatusCode };
                }

                // Ensure model is not null even if deserializer returned null
                if (model == null)
                {
                    model = new ApiResponseModel { data = null, message = responseContent, code = (int)response.StatusCode };
                }

                model.code = (int)response.StatusCode;
                return model;
            }
            catch (Exception ex)
            {

                throw ex;
            }
        }
        public async Task<ApiResponseModel> GetAsyncId(dynamic id, string endpoint)
        {
            var model = new ApiResponseModel();

            try
            {
                HttpClient clients = WebAPI.Initil();
                var url = $"{clients.BaseAddress}{endpoint}";

                if (id != null)
                    url = $"{url}?id={id}";

                using var httpClientHandler = new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                };

                using var client = new HttpClient(httpClientHandler)
                {
                    Timeout = TimeSpan.FromMinutes(30)
                };

                if (!string.IsNullOrWhiteSpace(Token))
                    client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);

                var response = await client.GetAsync(url);
                var responseContent = await response.Content.ReadAsStringAsync();
                var obj = JsonConvert.DeserializeObject<object>(responseContent);

                try
                {
                    model = JsonConvert.DeserializeObject<ApiResponseModel>(responseContent);
                }
                catch
                {
                    // fallback: wrap raw response
                    model = new ApiResponseModel { data = null, message = responseContent, code = (int)response.StatusCode };
                }

                // Ensure model is not null even if deserializer returned null
                if (model == null)
                {
                    model = new ApiResponseModel { data = null, message = responseContent, code = (int)response.StatusCode };
                }

                model.code = (int)response.StatusCode;
                return model;

            }
            catch (Exception ex)
            {

                throw ex;
            }
        }
        public async Task<ApiResponseModel> PostAsync(dynamic input, string endpoint)
        {
            var model = new ApiResponseModel();

            try
            {

                StringContent data = new StringContent("");
                if (input != null)
                {
                    var json = JsonConvert.SerializeObject(input);
                    data = new StringContent(json, Encoding.UTF8, "application/json");
                }

                HttpClient clients = WebAPI.APIUrl();
                var url = $"{clients.BaseAddress}/{endpoint}";
                using var httpClientHandler = new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
                };

                using var client = new HttpClient(httpClientHandler)
                {
                    Timeout = TimeSpan.FromMinutes(30)
                };

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);

                var response = await client.PostAsync(url, data);
                var responseContent = await response.Content.ReadAsStringAsync();

                try
                {
                    model = JsonConvert.DeserializeObject<ApiResponseModel>(responseContent);
                }
                catch
                {
                    // fallback: wrap raw response
                    model = new ApiResponseModel { data = null, message = responseContent, code = (int)response.StatusCode };
                }

                // Ensure model is not null even if deserializer returned null
                if (model == null)
                {
                    model = new ApiResponseModel { data = null, message = responseContent, code = (int)response.StatusCode };
                }

                model.code = (int)response.StatusCode;    



                return model;
            }
            catch (Exception ex)
            {
                return new ApiResponseModel { code = 500, message = ex.Message, data = null };
            }
        }
    }
}
