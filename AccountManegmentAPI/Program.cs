using AccountManagement.API;
using AccountManagement.Repository.Interface.Interfaces.Authentication;
using AccountManagement.Repository.Interface.Repository.ItemMaster;
using AccountManagement.Repository.Interface.Repository.FormPermissionMaster;
using AccountManagement.Repository.Interface.Repository.MasterList;
using AccountManagement.Repository.Interface.Repository.SiteMaster;
using AccountManagement.Repository.Interface.Services.AuthenticationService;
using AccountManagement.Repository.Interface.Services.ItemMaster;
using AccountManagement.Repository.Interface.Services.FormPermissionMasterService;
using AccountManagement.Repository.Interface.Services.MasterList;
using AccountManagement.Repository.Interface.Services.SiteMaster;
using AccountManagement.Repository.Repository.AuthenticationRepository;
using AccountManagement.Repository.Repository.ItemMasterRepository;
using AccountManagement.Repository.Repository.FormPermissionMasterRepository;
using AccountManagement.Repository.Repository.MasterListRepository;
using AccountManagement.Repository.Repository.SiteMasterRepository;
using AccountManagement.Repository.Services.Authentication;
using AccountManagement.Repository.Services.FormPermissionMaster;
using AccountManagement.Repository.Services.MasterList;
using AccountManagement.Repository.Services.SiteMaster;
using Microsoft.EntityFrameworkCore;
using AccountManagement.Repository.Services.ItemMaster;
using AccountManagement.Repository.Interface.Repository.Supplier;
using AccountManagement.Repository.Repository.SupplierRepository;
using AccountManagement.Repository.Interface.Services.SupplierService;
using AccountManagement.Repository.Services.Supplier;
using AccountManagement.Repository.Repository.CompanyRepository;
using AccountManagement.Repository.Interface.Repository.Company;
using AccountManagement.Repository.Interface.Services.CompanyService;
using AccountManagement.Repository.Services.Company;
using AccountManagement.Repository.Interface.Repository.PurchaseRequest;
using AccountManagement.Repository.Repository.PurchaseRequestRepository;
using AccountManagement.Repository.Interface.Services.PurchaseRequestService;
using AccountManagement.Repository.Services.PurchaseRequest;
using AccountManagement.Repository.Interface.Repository.InvoiceMaster;
using AccountManagement.Repository.Repository.InvoiceMasterRepository;
using AccountManagement.Repository.Interface.Services.InvoiceMaster;
using AccountManagement.Repository.Services.InvoiceMaster;
using AccountManagement.Repository.Interface.Repository.PurchaseOrder;
using AccountManagement.Repository.Repository.PurchaseOrderRepository;
using AccountManagement.Repository.Interface.Services.PurchaseOrderService;
using AccountManagement.Repository.Services.PurchaseOrder;
using AccountManagement.Repository.Repository.ItemInWordRepository;
using AccountManagement.Repository.Interface.Services.ItemInWordService;
using AccountManagement.Repository.Services.ItemInWord;
using Microsoft.OpenApi.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using AccountManagement.Repository.Interface.Repository.Sales;
using AccountManagement.Repository.Repository.SalesRepository;
using AccountManagement.Repository.Interface.Services.SalesIInvoiceService;
using AccountManagement.Repository.Services.Sales;
//using AccountManagement.DBContext.DBContext;
using AccountManagement.Repository.Interface.Repository.IItemInWord;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();

// Secrets come from user-secrets (dev) or environment variables (servers), never appsettings.json.
var accDbConn = builder.Configuration.GetConnectionString("ACCDbconn");
if (string.IsNullOrWhiteSpace(accDbConn))
{
    throw new InvalidOperationException(
        "Connection string 'ACCDbconn' is not configured. Set it with " +
        "dotnet user-secrets set \"ConnectionStrings:ACCDbconn\" \"<value>\" --project AccountManegmentAPI, " +
        "or set the environment variable ConnectionStrings__ACCDbconn. See README.md.");
}

var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
    throw new InvalidOperationException(
        "'Jwt:Key' is not configured. Set it with " +
        "dotnet user-secrets set \"Jwt:Key\" \"<value>\" --project AccountManegmentAPI, " +
        "or set the environment variable Jwt__Key. See README.md.");
}

builder.Services.AddDbContext<DbaccManegmentContext>(option =>
option.UseSqlServer(accDbConn));


builder.Services.AddScoped<IAuthentication, UserAuthentication>();
builder.Services.AddScoped<IMasterList, MasterListRepo>();
builder.Services.AddScoped<IFormPermissionMaster, FormPermissionMasterRepo>();
builder.Services.AddScoped<ISiteMaster, SiteMasterRepo>();
builder.Services.AddScoped<IItemMaster, ItemMasterRepo>();
builder.Services.AddScoped<ISupplierMaster, SupplierMasterRepo>();
builder.Services.AddScoped<ICompany, CompanyRepo>();
builder.Services.AddScoped<IPurchaseRequest, PurchaseRequestRepo>();
builder.Services.AddScoped<IPurchaseOrder, PurchaseOrderRepo>();
builder.Services.AddScoped<IPurchaseOrderDetails, PurchaseOrderDetailsRepo>();
builder.Services.AddScoped<ISupplierInvoice, SupplierInvoiceRepo>();
builder.Services.AddScoped<IItemInward, ItemInwardRepo>();
builder.Services.AddScoped<ISupplierInvoiceDetails, SupplierInvoiceDetailsRepo>();
builder.Services.AddScoped<IFormMaster, FormMasterRepo>();
builder.Services.AddScoped<ISalesInvoice, SalesRepo>();



builder.Services.AddScoped<IAuthenticationService, AuthenticationService>();
builder.Services.AddScoped<IMasterListServices, MasterListService>();
builder.Services.AddScoped<ISiteMasterServices, SiteMasterService>();
builder.Services.AddScoped<IFormPermissionMasterService, FormPermissionMasterService>();
builder.Services.AddScoped<IItemMasterServices, ItemMasterServices>();
builder.Services.AddScoped<ISupplierServices, SupplierServices>();
builder.Services.AddScoped<ICompanyService, CompanyService>();
builder.Services.AddScoped<IPurchaseRequestService, PurchaseRequestService>();
builder.Services.AddScoped<IPurchaseOrderServices, PurchaseOrderServices>();
builder.Services.AddScoped<IPurchaseOrderDetailsServices, PurchaseOrderDetailsServices>();
builder.Services.AddScoped<ISupplierInvoiceService, SupplierInvoiceService>();
builder.Services.AddScoped<IItemInwardService, ItemInwardService>();
builder.Services.AddScoped<ISupplierInvoiceDetailsService, SupplierInvoiceDetailsService>();
builder.Services.AddScoped<IFormMasterServices, FormMasterService>();
builder.Services.AddScoped<ISalesInvoiceService, SalesInvoiceService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("https://avfast.in", "https://www.avfast.in")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});


builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidIssuer = builder.Configuration["Jwt:Issuer"],
        ValidAudience = builder.Configuration["Jwt:Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
    };
});


builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v2", new OpenApiInfo { Title = "Account API", Version = "v2", Description = "Account" });

    c.ResolveConflictingActions(apiDescriptions => apiDescriptions.First());
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        In = ParameterLocation.Header,
        Description = "Please insert JWT with Bearer into field",
        Name = "Authorization",
        Type = SecuritySchemeType.ApiKey

    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement {
                     {
                         new OpenApiSecurityScheme
                         {
                           Reference = new OpenApiReference
                           {
                             Type = ReferenceType.SecurityScheme,
                             Id = "Bearer"
                           }
                          },
                          new string[] { }
                     }
                });
});


builder.Services.AddDistributedMemoryCache();

builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromMinutes(160);
});

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();
app.UseCors("AllowFrontend");
app.UseSwagger();
app.UseSwaggerUI(options => options.SwaggerEndpoint("/swagger/v2/swagger.json", "Account"));
app.MapControllers();
app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.Run();
