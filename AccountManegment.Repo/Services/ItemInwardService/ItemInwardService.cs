using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.ItemInWord;
using AccountManagement.Repository.Interface.Repository.PurchaseRequest;
using AccountManagement.Repository.Interface.Services.ItemInWordService;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Services.ItemInWord
{
    public class ItemInwardService : IItemInwardService
    {
        private readonly Interface.Repository.IItemInWord.IItemInward itemInWord;

        public ItemInwardService(Interface.Repository.IItemInWord.IItemInward itemInWord)
        {
            this.itemInWord = itemInWord;
        }
        public async Task<ApiResponseModel> AddItemInWordDetails(ItemInWordModel ItemInWordDetails)
        {
            return await itemInWord.AddItemInWordDetails(ItemInWordDetails);
        }

        public async Task<ApiResponseModel> DeleteItemInWord(Guid InwordId)
        {
            return await itemInWord.DeleteItemInWord(InwordId);
        }

        public async Task<IEnumerable<ItemInWordModel>> GetItemInWordList(InwardListRequestModel request)
        {
            return await itemInWord.GetItemInWordList(request);
        }

        public async Task<ItemInWordMasterView> GetItemInWordtDetailsById(Guid InwordId)
        {
            return await itemInWord.GetItemInWordtDetailsById(InwordId);
        }

        public async Task<ApiResponseModel> ItemInWordIsApproved(Guid InwordId)
        {
            return await itemInWord.ItemInWordIsApproved(InwordId);
        }

        public async Task<ApiResponseModel> UpdateItemInWordDetails(ItemInWordModel ItemInWordDetails)
        {
            return await itemInWord.UpdateItemInWordDetails(ItemInWordDetails);
        }
        public async Task<ApiResponseModel> InsertMultipleItemInWordDetails(ItemInWordMasterView ItemInWordDetails)
        {
            return await itemInWord.InsertMultipleItemInWordDetails(ItemInWordDetails);
        }

        public async Task<ApiResponseModel> UpdatetMultipleItemInWordDetails(ItemInWordMasterView UpdateInWordDetails)
        {
            return await itemInWord.UpdatetMultipleItemInWordDetails(UpdateInWordDetails);
        }

        public async Task<ApiResponseModel> MultipleInwardIsApproved(InwardIsApprovedMasterModel InwardList)
        {
            return await itemInWord.MultipleInwardIsApproved(InwardList);
        }
    }
}
