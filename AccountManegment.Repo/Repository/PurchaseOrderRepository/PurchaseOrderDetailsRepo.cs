using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.PurchaseOrder;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Repository.PurchaseOrder;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.PurchaseOrderRepository
{
    public class PurchaseOrderDetailsRepo : IPurchaseOrderDetails
    {
        public PurchaseOrderDetailsRepo(DbaccManegmentContext context)
        {
            Context = context;
        }
        public DbaccManegmentContext Context { get; }

        public async Task<ApiResponseModel> AddPurchaseOrderDetails(PurchaseOrderDetailsModel PurchaseOrderDetails)
        {
            ApiResponseModel responseModel = new ApiResponseModel();
            try
            {
                var PurchaseOrder = new PurchaseOrderDetail()
                {
                    PorefId = PurchaseOrderDetails.Poid,
                    ItemId = PurchaseOrderDetails.ItemId,
                    ItemName = PurchaseOrderDetails.ItemName,
                    UnitTypeId = PurchaseOrderDetails.UnitTypeId,
                    Quantity = PurchaseOrderDetails.Quantity,
                    Price = PurchaseOrderDetails.Price,
                    Discount = PurchaseOrderDetails.Discount,
                    Gst = PurchaseOrderDetails.Gst,
                    CreatedBy = PurchaseOrderDetails.CreatedBy,
                    CreatedOn = DateTime.Now,
                };
                responseModel.code = (int)HttpStatusCode.OK;
                responseModel.message = "Purchase order details successfully inserted.";
                Context.PurchaseOrderDetails.Add(PurchaseOrder);
                Context.SaveChanges();
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return responseModel;
        }

        public Task<ApiResponseModel> DeletePurchaseOrderDetails(int Id)
        {
            throw new NotImplementedException();
        }

        public async Task<PurchaseOrderDetailsModel> GetPurchaseOrderDetailsById(int Id)
        {
            PurchaseOrderDetailsModel PurchaseOrder = new PurchaseOrderDetailsModel();
            try
            {
                PurchaseOrder = (from a in Context.PurchaseOrderDetails.Where(x => x.Id == Id)
                                 join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                 join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                 select new PurchaseOrderDetailsModel
                                 {
                                     Id = a.Id,
                                     Poid = a.PorefId,
                                     ItemId = a.ItemId,
                                     ItemName = i.ItemName,
                                     UnitTypeId = a.UnitTypeId,
                                     UnitTypeName = b.UnitName,
                                     Quantity = a.Quantity,
                                     Price = a.Price,
                                     Discount = a.Discount,
                                     Gst = a.Gst,
                                     CreatedBy = a.CreatedBy,
                                     CreatedOn = a.CreatedOn,
                                 }).First();
                return PurchaseOrder;
            }
            catch (Exception)
            {
                throw;
            }
        }

        public async Task<IEnumerable<PurchaseOrderDetailsModel>> GetPurchaseOrderDetailsList()
        {
            try
            {
                var PurchaseOrder = (from a in Context.PurchaseOrderDetails
                                     join b in Context.UnitMasters on a.UnitTypeId equals b.UnitId
                                     join i in Context.ItemMasters on a.ItemId equals i.ItemId
                                     select new PurchaseOrderDetailsModel
                                     {
                                         Id = a.Id,
                                         Poid = a.PorefId,
                                         ItemName = i.ItemName,
                                         UnitTypeId = a.UnitTypeId,
                                         UnitTypeName = b.UnitName,
                                         Quantity = a.Quantity,
                                         Price = a.Price,
                                         Discount = a.Discount,
                                         Gst = a.Gst,
                                         CreatedBy = a.CreatedBy,
                                         CreatedOn = a.CreatedOn,
                                     });
                return PurchaseOrder;
            }
            catch (Exception)
            {

                throw;
            }
        }

        public async Task<ApiResponseModel> UpdatePurchaseOrderDetails(PurchaseOrderDetailsModel PurchaseOrderDetails)
        {
            ApiResponseModel responseModel = new ApiResponseModel();
            var PurchaseOrder = Context.PurchaseOrderDetails.Where(a => a.Id == PurchaseOrderDetails.Id).FirstOrDefault();
            try
            {
                if (PurchaseOrder != null)
                {
                    PurchaseOrder.Id = PurchaseOrderDetails.Id;
                    PurchaseOrder.PorefId = PurchaseOrderDetails.Poid;
                    PurchaseOrder.ItemId = PurchaseOrderDetails.ItemId;
                    PurchaseOrder.ItemName = PurchaseOrderDetails.ItemName;
                    PurchaseOrder.UnitTypeId = PurchaseOrderDetails.UnitTypeId;
                    PurchaseOrder.Quantity = PurchaseOrderDetails.Quantity;
                    PurchaseOrder.Price = PurchaseOrderDetails.Price;
                    PurchaseOrder.Discount = PurchaseOrderDetails.Discount;
                    PurchaseOrder.Gst = PurchaseOrderDetails.Gst;
                    PurchaseOrder.CreatedBy = PurchaseOrderDetails.CreatedBy;
                    PurchaseOrder.CreatedOn = PurchaseOrderDetails.CreatedOn;
                }
                ;
                responseModel.code = (int)HttpStatusCode.OK;
                responseModel.message = "Purchase order details successfully updated.";
                Context.PurchaseOrderDetails.Update(PurchaseOrder);
                Context.SaveChanges();
            }
            catch (Exception ex)
            {
                throw ex;
            }
            return responseModel;
        }
    }
}
