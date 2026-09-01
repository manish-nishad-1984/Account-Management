using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.ViewModels;
using AccountManagement.DBContext.Models.ViewModels.FormMaster;
using AccountManagement.Repository.Interface.Repository.MasterList;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.MasterListRepository
{
    public class FormMasterRepo : IFormMaster
    {
        public FormMasterRepo(DbaccManegmentContext context)
        {
            Context = context;
        }

        public DbaccManegmentContext Context { get; }

        public async Task<IEnumerable<FormMasterModel>> GetFormGroupList()
        {
            try
            {
                IEnumerable<FormMasterModel> FormList = Context.Forms.ToList().Select(a => new FormMasterModel
                {
                    FormId = a.FormId,
                    FormGroup = a.FormGroup,
                    FormName = a.FormName,
                });
                return FormList;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }
    }
}
