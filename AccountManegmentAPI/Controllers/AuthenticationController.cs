using AccountManagement.DBContext.Models.DataTableParameters;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Services.AuthenticationService;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Net;

namespace AccountManagement.API.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthenticationController : ControllerBase
    {
        public AuthenticationController(IAuthenticationService authentication)
        {
            Authentication = authentication;
        }

        public IAuthenticationService Authentication { get; }

        [AllowAnonymous]
        [HttpPost("Login")]
        public async Task<IActionResult> Login(LoginRequest login)
        {
            LoginResponseModel loginresponsemodel = new LoginResponseModel();
            try
            {

                var result = await Authentication.LoginUser(login);

                if (result != null && result.Data != null)
                {
                    var token = Authentication.GenerateToken(login);
                    // preserve service status code/message when available
                    loginresponsemodel.Code = result.Code != 0 ? result.Code : (int)HttpStatusCode.OK;
                    loginresponsemodel.Data = result.Data;
                    loginresponsemodel.Message = result.Message;
                }
                else if (result != null)
                {
                    // preserve service-provided failure code and message
                    loginresponsemodel.Message = result.Message;
                    loginresponsemodel.Code = result.Code != 0 ? result.Code : (int)HttpStatusCode.NotFound;
                }
                else
                {
                    loginresponsemodel.Message = "Authentication service returned no result.";
                    loginresponsemodel.Code = (int)HttpStatusCode.InternalServerError;
                }
            }
            catch (Exception ex)
            {
                loginresponsemodel.Code = (int)HttpStatusCode.InternalServerError;
            }
            return StatusCode(loginresponsemodel.Code, loginresponsemodel);
        }

        [HttpPost("GetAllUserList")]
        [Authorize]
        public async Task<IActionResult> GetAllUserList(string? searchText, string? searchBy, string? sortBy)
        {
            IEnumerable<LoginView> userList = await Authentication.GetUsersList(searchText, searchBy, sortBy);
            return Ok(new { code = 200, data = userList.ToList() });
        }

        [HttpGet]
        [Route("GetUserById")]
        [Authorize]

        public async Task<IActionResult> GetEmployeeById(Guid UserId)
        {
            var userProfile = await Authentication.GetUserById(UserId);
            return Ok(new { code = 200, data = userProfile });
        }

        [HttpPost]
        [Route("CreateUser")]
        [Authorize]

        public async Task<IActionResult> CreateUser(UserViewModel UpdateUser)
        {
            UserResponceModel response = new UserResponceModel();
            var updateUser = await Authentication.CreateUser(UpdateUser);
            if (updateUser.Code == 200)
            {
                response.Code = (int)HttpStatusCode.OK;
                response.Message = updateUser.Message;
                response.Icone = updateUser.Icone;
            }
            else
            {
                response.Code = updateUser.Code;
                response.Message = updateUser.Message;
            }
            return StatusCode(response.Code, response);
        }
        [HttpPost]
        [Route("UpdateUserDetails")]
        [Authorize]

        public async Task<IActionResult> UpdateUserDetails(UserViewModel UpdateUser)
        {
            UserResponceModel response = new UserResponceModel();
            var updateUser = await Authentication.UpdateUserDetails(UpdateUser);
            if (updateUser.Code == 200)
            {
                response.Code = (int)HttpStatusCode.OK;
                response.Message = updateUser.Message;
                response.Icone = updateUser.Icone;
            }
            else
            {
                response.Code = updateUser.Code;
                response.Message = updateUser.Message;
            }
            return StatusCode(response.Code, response);
        }

        [HttpPost]
        [Route("ActiveDeactiveUsers")]
        [Authorize]
        public async Task<IActionResult> ActiveDeactiveUsers(Guid UserId)
        {
            UserResponceModel responseModel = new UserResponceModel();

            var userName = await Authentication.ActiveDeactiveUsers(UserId);
            try
            {
                if (responseModel.Code == 200)
                {
                    responseModel.Code = userName.Code;
                    responseModel.Message = userName.Message;
                }
                else
                {
                    responseModel.Message = userName.Message;
                    responseModel.Code = userName.Code;
                }
            }
            catch (Exception ex)
            {
                responseModel.Code = (int)HttpStatusCode.InternalServerError;
            }
            return StatusCode(responseModel.Code, responseModel);
        }
        [HttpPost]
        [Route("DeleteUserDetails")]
        [Authorize]
        public async Task<IActionResult> DeleteUserDetails(Guid UserId)
        {
            UserResponceModel responseModel = new UserResponceModel();

            var User = await Authentication.DeleteUserDetails(UserId);
            try
            {
                if (responseModel.Code == 200)
                {
                    responseModel.Code = User.Code;
                    responseModel.Message = User.Message;
                }
                else
                {
                    responseModel.Message = User.Message;
                    responseModel.Code = User.Code;
                }
            }
            catch (Exception ex)
            {
                responseModel.Code = (int)HttpStatusCode.InternalServerError;
            }
            return StatusCode(responseModel.Code, responseModel);
        }
    }
}
