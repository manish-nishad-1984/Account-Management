
using AccountManagement.API;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.DBContext.Models.ViewModels;
using AccountManagement.DBContext.Models.ViewModels.UserModels;
using AccountManagement.Repository.Interface.Repository.MasterList;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AccountManagement.Repository.Repository.MasterListRepository
{
    public class MasterListRepo : IMasterList
    {
        public MasterListRepo(DbaccManegmentContext context)
        {
            Context = context;
        }

        public DbaccManegmentContext Context { get; }

        public async Task<IEnumerable<CityView>> GetCities(int cityid)
        {
            try
            {
                IEnumerable<CityView> cities = Context.Cities.Where(e => e.State.StatesId == cityid).ToList().Select(a => new CityView
                {
                    Id = a.CityId,
                    CityName = a.CityName,
                });
                return cities;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }

        public async Task<IEnumerable<CountryView>> GetCountries()
        {
            try
            {
                IEnumerable<CountryView> countries = Context.Countries.ToList().Select(a => new CountryView
                {
                    Id = a.CountryId,
                    CountryName = a.CountryName,
                });
                return countries;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }



        public async Task<IEnumerable<StateView>> GetStates(int stateid)
        {
            try
            {
                IEnumerable<StateView> states = Context.States.Where(e => e.Country.CountryId == stateid).ToList().Select(a => new StateView
                {
                    Id = a.StatesId,
                    StateName = a.StatesName
                });
                return states;
            }
            catch (Exception ex)
            {
                throw ex;
            }
        }



    }
}
