using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.InvoiceMaster;
using AccountManagement.DBContext.Models.ViewModels.ItemInWord;
using AccountManagement.DBContext.Models.ViewModels.PurchaseRequest;
using AccountManagement.DBContext.Models.ViewModels.SupplierMaster;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Interface.Repository.IItemInWord
{
    public interface IItemInward
    {
        Task<IEnumerable<ItemInWordModel>> GetItemInWordList(InwardListRequestModel request);
        Task<ApiResponseModel> AddItemInWordDetails(ItemInWordModel ItemInWordDetails);
        Task<ItemInWordMasterView> GetItemInWordtDetailsById(Guid InwordId);
        Task<ApiResponseModel> UpdateItemInWordDetails(ItemInWordModel ItemInWordDetails);
        Task<ApiResponseModel> ItemInWordIsApproved(Guid InwordId);
        Task<ApiResponseModel> DeleteItemInWord(Guid InwordId);
        Task<ApiResponseModel> InsertMultipleItemInWordDetails(ItemInWordMasterView ItemInWordDetails);
        Task<ApiResponseModel> UpdatetMultipleItemInWordDetails(ItemInWordMasterView UpdateInWordDetails);
        Task<ApiResponseModel> MultipleInwardIsApproved(InwardIsApprovedMasterModel InwardList);
    }
}
