using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.API;
using AccountManagement.DBContext.Models.ViewModels.SiteMaster;
using AccountManagement.DBContext.Models.ViewModels.SupplierMaster;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Repository.Supplier;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Client;
using System;
using System.Collections.Generic;
using System.ComponentModel.Design;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.SupplierRepository
{
    public class SupplierMasterRepo : ISupplierMaster
    {
        public SupplierMasterRepo(DbaccManegmentContext context)
        {
            Context = context;
        }
        public DbaccManegmentContext Context { get; }
        public async Task<ApiResponseModel> ActiveDeactiveSupplier(Guid SupplierId)
        {
            ApiResponseModel response = new ApiResponseModel();
            var Getsupplierdata = Context.SupplierMasters.Where(a => a.SupplierId == SupplierId).FirstOrDefault();

            if (Getsupplierdata != null)
            {
                if (Getsupplierdata.IsApproved == true)
                {
                    Getsupplierdata.IsApproved = false;
                    Context.SupplierMasters.Update(Getsupplierdata);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = Getsupplierdata;
                    response.message = "Supplier is deactive succesfully.";
                }
                else
                {
                    Getsupplierdata.IsApproved = true;
                    Context.SupplierMasters.Update(Getsupplierdata);
                    Context.SaveChanges();
                    response.code = 200;
                    response.data = Getsupplierdata;
                    response.message = "Supplier is active succesfully.";
                }
            }
            return response;
        }
        public async Task<ApiResponseModel> CreateSupplier(SupplierModel supplier)
        {
            ApiResponseModel response = new ApiResponseModel();

            try
            {
                if (supplier == null)
                {
                    response.code = 400;
                    response.message = "Supplier details are null.";
                    return response;
                }

                var existingSupplier = Context.SupplierMasters.FirstOrDefault(x => x.SupplierName == supplier.SupplierName);
                if (existingSupplier != null)
                {
                    if (existingSupplier.IsDelete == true)
                    {
                        existingSupplier.SupplierName = supplier.SupplierName;
                        existingSupplier.Mobile = supplier.Mobile;
                        existingSupplier.Email = supplier.Email;
                        existingSupplier.Gstno = supplier.Gstno;
                        existingSupplier.BuildingName = supplier.BuildingName;
                        existingSupplier.Area = supplier.Area;
                        existingSupplier.City = supplier.City;
                        existingSupplier.State = supplier.State;
                        existingSupplier.PinCode = supplier.PinCode;
                        existingSupplier.BankName = supplier.BankName;
                        existingSupplier.BankBranch = supplier.BranchName;
                        existingSupplier.AccountNo = supplier.AccountNo;
                        existingSupplier.Iffccode = supplier.Iffccode;
                        existingSupplier.CreatedBy = supplier.CreatedBy;
                        existingSupplier.CreatedOn = DateTime.Now;
                        existingSupplier.IsApproved = true;
                        existingSupplier.IsDelete = false;


                        Context.SupplierMasters.Update(existingSupplier);
                        await Context.SaveChangesAsync();
                        response.code = (int)HttpStatusCode.OK;
                        response.message = "Supplier successfully inserted.";

                    }
                    else
                    {
                        response.code = 400;
                        response.message = "Supplier already exists.";
                    }
                }
                else
                {
                    var supplierMaster = new SupplierMaster()
                    {
                        SupplierId = Guid.NewGuid(),
                        SupplierName = supplier.SupplierName,
                        Mobile = supplier.Mobile,
                        Email = supplier.Email,
                        Gstno = supplier.Gstno,
                        BuildingName = supplier.BuildingName,
                        Area = supplier.Area,
                        City = supplier.City,
                        State = supplier.State,
                        PinCode = supplier.PinCode,
                        BankName = supplier.BankName,
                        BankBranch = supplier.BranchName,
                        AccountNo = supplier.AccountNo,
                        Iffccode = supplier.Iffccode,
                        CreatedBy = supplier.CreatedBy,
                        CreatedOn = DateTime.Now,
                        IsApproved = true,
                        IsDelete = false,

                    };

                    Context.SupplierMasters.Add(supplierMaster);
                    await Context.SaveChangesAsync();

                    response.code = (int)HttpStatusCode.OK;
                    response.message = "Supplier successfully created.";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "An error occurred while creating the supplier.";
            }

            return response;
        }
        public async Task<ApiResponseModel> DeleteSupplierDetails(Guid SupplierId)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var Userdata = Context.SupplierMasters.Where(a => a.SupplierId == SupplierId).FirstOrDefault();
                var InvoiceDetails = Context.SupplierInvoices.Where(a => a.SupplierId == SupplierId).ToList();

                if (Userdata != null)
                {
                    if (InvoiceDetails.Count > 0)
                    {
                        response.code = 404;
                        response.message = "Invoice is created for this supplier.";
                    }
                    else
                    {
                        Userdata.IsDelete = true;
                        Context.SupplierMasters.Update(Userdata);
                        Context.SaveChanges();
                        response.code = 200;
                        response.message = "Supplier is successfully deleted.";
                    }
                }
            }
            catch (Exception ex)
            {
                response.code = 404;
                response.message = "Error in deleting the supplier.";
            }
            return response;
        }
        public async Task<SupplierModel> GetSupplierById(Guid SupplierId)
        {

            SupplierModel Userdata = new SupplierModel();
            try
            {
                Userdata = (from e in Context.SupplierMasters
                            join s in Context.States on e.State equals s.StatesId
                            join c in Context.Cities on e.City equals c.CityId
                            where e.SupplierId == SupplierId
                            select new SupplierModel
                            {
                                SupplierId = e.SupplierId,
                                SupplierName = e.SupplierName,
                                Gstno = e.Gstno,
                                Email = e.Email,
                                Mobile = e.Mobile,
                                IsApproved = e.IsApproved,
                                Area = e.Area,
                                PinCode = e.PinCode,
                                BuildingName = e.BuildingName,
                                StateName = s.StatesName,
                                State = e.State,
                                City = e.City,
                                CityName = c.CityName,
                                BankName = e.BankName,
                                BranchName = e.BankBranch,
                                AccountNo = e.AccountNo,
                                Iffccode = e.Iffccode,

                                FullAddress = e.BuildingName + "-" + e.Area + "," + c.CityName + "," + s.StatesName + "-" + e.PinCode
                            }).First();
                return Userdata;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<IEnumerable<SupplierModel>> GetSupplierList(string? searchText, string? searchBy, string? sortBy)
        {
            try
            {
                IEnumerable<SupplierModel> SupplierList = (from e in Context.SupplierMasters
                                                           join s in Context.States on e.State equals s.StatesId
                                                           join c in Context.Cities on e.City equals c.CityId
                                                           where e.IsDelete == false
                                                           select new SupplierModel
                                                           {
                                                               SupplierId = e.SupplierId,
                                                               SupplierName = e.SupplierName,
                                                               Gstno = e.Gstno,
                                                               Email = e.Email,
                                                               Mobile = e.Mobile,
                                                               IsApproved = e.IsApproved,
                                                               CityName = c.CityName,
                                                               CreatedOn = e.CreatedOn,

                                                           });


                if (!string.IsNullOrEmpty(searchText))
                {
                    searchText = searchText.ToLower();
                    SupplierList = SupplierList.Where(u =>
                        u.SupplierName.ToLower().Contains(searchText) ||
                        u.Gstno.ToLower().Contains(searchText)
                    );
                }

                if (!string.IsNullOrEmpty(searchText) && !string.IsNullOrEmpty(searchBy))
                {
                    searchText = searchText.ToLower();
                    switch (searchBy.ToLower())
                    {
                        case "suppliername":
                            SupplierList = SupplierList.Where(u => u.SupplierName.ToLower().Contains(searchText));
                            break;
                        default:
                            break;
                    }
                }

                if (string.IsNullOrEmpty(sortBy))
                {
                    SupplierList = SupplierList.OrderByDescending(u => u.CreatedOn);
                }
                else
                {
                    string sortOrder = sortBy.StartsWith("Ascending") ? "ascending" : "descending";
                    string field = sortBy.Substring(sortOrder.Length);

                    switch (field.ToLower())
                    {
                        case "suppliername":
                            if (sortOrder == "ascending")
                                SupplierList = SupplierList.OrderBy(u => u.SupplierName);
                            else if (sortOrder == "descending")
                                SupplierList = SupplierList.OrderByDescending(u => u.SupplierName);
                            break;
                        case "createdon":
                            if (sortOrder == "ascending")
                                SupplierList = SupplierList.OrderBy(u => u.CreatedOn);
                            else if (sortOrder == "descending")
                                SupplierList = SupplierList.OrderByDescending(u => u.CreatedOn);
                            break;
                        default:

                            break;
                    }
                }

                return SupplierList.ToList();
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<IEnumerable<SupplierModel>> GetSupplierNameList()
        {
            try
            {
                IEnumerable<SupplierModel> SupplierName = Context.SupplierMasters
                    .Where(e => e.IsDelete == false)
                    .OrderBy(a => a.SupplierName)
                    .Select(a => new SupplierModel
                    {
                        SupplierId = a.SupplierId,
                        SupplierName = a.SupplierName,
                    }).ToList();

                return SupplierName;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<ApiResponseModel> UpdateSupplierDetails(SupplierModel UpdateSupplier)
        {

            try
            {
                ApiResponseModel response = new ApiResponseModel();
                var Userdata = await Context.SupplierMasters.FirstOrDefaultAsync(a => a.SupplierId == UpdateSupplier.SupplierId);
                if (Userdata != null)
                {
                    Userdata.SupplierId = UpdateSupplier.SupplierId;
                    Userdata.SupplierName = UpdateSupplier.SupplierName;
                    Userdata.Gstno = UpdateSupplier.Gstno;
                    Userdata.Area = UpdateSupplier.Area;
                    Userdata.BuildingName = UpdateSupplier.BuildingName;
                    Userdata.PinCode = UpdateSupplier.PinCode;
                    Userdata.City = UpdateSupplier.City;
                    Userdata.State = UpdateSupplier.State;
                    Userdata.Email = UpdateSupplier.Email;
                    Userdata.Mobile = UpdateSupplier.Mobile;
                    Userdata.BankName = UpdateSupplier.BankName;
                    Userdata.BankBranch = UpdateSupplier.BranchName;
                    Userdata.AccountNo = UpdateSupplier.AccountNo;
                    Userdata.Iffccode = UpdateSupplier.Iffccode;
                    Userdata.UpdatedBy = UpdateSupplier.CreatedBy;
                    Userdata.UpdatedOn = DateTime.Now;
                    Context.SupplierMasters.Update(Userdata);
                    Context.SaveChanges();
                }
                response.code = (int)HttpStatusCode.OK;
                response.message = "Supplier details successfully updated.";
                return response;

            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
        public async Task<ApiResponseModel> ImportSupplierListFromExcel(List<SupplierModel> supplierList)
        {
            ApiResponseModel response = new ApiResponseModel();
            List<SupplierMaster> suppliersToAdd = new List<SupplierMaster>();
            List<SupplierMaster> suppliersToUpdate = new List<SupplierMaster>();
            HashSet<string> supplierNames = new HashSet<string>();
            try
            {
                foreach (var supplierDetails in supplierList)
                {
                    var stateId = await Context.States.FirstOrDefaultAsync(x => x.StatesName == supplierDetails.StateName);
                    var cityId = await Context.Cities.FirstOrDefaultAsync(x => x.CityName == supplierDetails.CityName);
                    if (stateId != null)
                    {
                        if (cityId == null)
                        {
                            int index = supplierList.IndexOf(supplierDetails) + 1;
                            string cityName = supplierDetails.CityName;
                            response.code = 400;
                            response.message = $": {cityName} at row {index} does not match any data type.";
                            return response;
                        }
                    }
                    else
                    {
                        int index = supplierList.IndexOf(supplierDetails) + 1;
                        string stateName = supplierDetails.StateName;
                        response.code = 400;
                        response.message = $": {stateName} at row {index} does not match any data type.";
                        return response;
                    }

                    var existingSupplier = await Context.SupplierMasters.FirstOrDefaultAsync(x => x.SupplierName == supplierDetails.SupplierName);
                    if (existingSupplier != null)
                    {
                        if (existingSupplier.IsDelete == true)
                        {
                            existingSupplier.SupplierName = supplierDetails.SupplierName;
                            existingSupplier.Mobile = supplierDetails.Mobile;
                            existingSupplier.Email = supplierDetails.Email;
                            existingSupplier.Gstno = supplierDetails.Gstno;
                            existingSupplier.BuildingName = supplierDetails.BuildingName;
                            existingSupplier.Area = supplierDetails.Area;
                            existingSupplier.City = cityId.CityId;
                            existingSupplier.State = stateId.StatesId;
                            existingSupplier.PinCode = supplierDetails.PinCode;
                            existingSupplier.BankName = supplierDetails.BankName;
                            existingSupplier.AccountNo = supplierDetails.AccountNo;
                            existingSupplier.Iffccode = supplierDetails.Iffccode;
                            existingSupplier.CreatedBy = supplierDetails.CreatedBy;
                            existingSupplier.CreatedOn = DateTime.Now;
                            existingSupplier.IsApproved = true;
                            existingSupplier.IsDelete = false;

                            suppliersToUpdate.Add(existingSupplier);
                        }
                        else
                        {
                            response.code = 400;
                            response.message = $": {supplierDetails.SupplierName} is already exist.";
                            return response;
                        }

                    }
                    else
                    {
                        if (supplierNames.Contains(supplierDetails.SupplierName))
                        {
                            response.code = 400;
                            response.message = $": {supplierDetails.SupplierName} is duplicated in the data.";
                            return response;
                        }
                        else
                        {
                            supplierNames.Add(supplierDetails.SupplierName);
                        }

                        var supplierMaster = new SupplierMaster()
                        {
                            SupplierId = Guid.NewGuid(),
                            SupplierName = supplierDetails.SupplierName,
                            Mobile = supplierDetails.Mobile,
                            Email = supplierDetails.Email,
                            Gstno = supplierDetails.Gstno,
                            BuildingName = supplierDetails.BuildingName,
                            Area = supplierDetails.Area,
                            City = cityId.CityId,
                            State = stateId.StatesId,
                            PinCode = supplierDetails.PinCode,
                            BankName = supplierDetails.BankName,
                            AccountNo = supplierDetails.AccountNo,
                            Iffccode = supplierDetails.Iffccode,
                            CreatedBy = supplierDetails.CreatedBy,
                            CreatedOn = DateTime.Now,
                            IsApproved = true,
                            IsDelete = false,
                        };

                        suppliersToAdd.Add(supplierMaster);
                    }
                }

                if (suppliersToAdd.Any() || suppliersToUpdate.Any())
                {
                    if (suppliersToAdd.Any())
                    {
                        Context.SupplierMasters.AddRange(suppliersToAdd);
                    }
                    if (suppliersToUpdate.Any())
                    {
                        Context.SupplierMasters.UpdateRange(suppliersToAdd);
                    }

                    await Context.SaveChangesAsync();
                    response.code = (int)HttpStatusCode.OK;
                    response.message = "Supplier details successfully inserted";
                }
                else
                {
                    response.code = 400;
                    response.message = ": Failed to insert supplier details";
                }
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = ": An error occurred while processing the request";
            }
            return response;
        }
        public async Task<ApiResponseModel> MultipleSupplierIsApproved(SupplierIsApprovedMasterModel SupplierList)
        {
            ApiResponseModel response = new ApiResponseModel();
            try
            {
                var allSupplierData = await Context.SupplierMasters.ToListAsync();
                var approvalDict = SupplierList.SupplierList.ToDictionary(x => x.SupplierId, x => x.IsApproved);

                foreach (var Supplier in allSupplierData)
                {
                    if (approvalDict.TryGetValue(Supplier.SupplierId, out var isApproved))
                    {
                        Supplier.IsApproved = isApproved ?? false;
                    }

                    Context.SupplierMasters.Update(Supplier);
                }
                await Context.SaveChangesAsync();

                response.code = 200;
                response.message = "Supplier approved successfully.";
            }
            catch (Exception ex)
            {
                response.code = 500;
                response.message = "Error approving the supplier: " + ex.Message;
            }
            return response;
        }
    }
}
