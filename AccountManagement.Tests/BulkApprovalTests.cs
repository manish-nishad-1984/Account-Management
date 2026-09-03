using AccountManagement.API;
using AccountManagement.DBContext.Models.ViewModels.PurchaseOrder;
using AccountManagement.DBContext.Models.ViewModels.SupplierMaster;
using AccountManagement.Repository.Repository.PurchaseOrderRepository;
using AccountManagement.Repository.Repository.SupplierRepository;
using Microsoft.EntityFrameworkCore;

namespace AccountManagement.Tests;

/// <summary>
/// Characterisation tests for the bulk-approval methods.
///
/// These pin down finding P2 in Migration-Assessment/05-Performance-Analysis.md.
/// Every one of the seven bulk-approval methods used to do this:
///
///     var all = await Context.PurchaseOrders.ToListAsync();   // the WHOLE table
///     foreach (var row in all)
///     {
///         if (dict.TryGetValue(row.Id, out var approved)) { row.IsApproved = approved; }
///         Context.PurchaseOrders.Update(row);                 // ...marked dirty ANYWAY
///     }
///     await Context.SaveChangesAsync();
///
/// Note that Update() sits OUTSIDE the if. Approving one purchase order therefore
/// issued an UPDATE against every row in the table, writing every column.
///
/// THE IMPORTANT THING ABOUT THESE TESTS: asserting on the final IsApproved values
/// would pass against the OLD code too, because the old code did arrive at the
/// correct values -- it just rewrote the entire table to get there. So the
/// assertions below are on how many rows were LOADED AND TRACKED, which is the
/// thing that actually changed. A test that only checked values would give false
/// confidence and let the regression back in.
/// </summary>
public class BulkApprovalTests
{
    private static DbaccManegmentContext NewContext()
    {
        // A distinct database name per context keeps tests independent.
        var options = new DbContextOptionsBuilder<DbaccManegmentContext>()
            .UseInMemoryDatabase($"bulk-approval-{Guid.NewGuid()}")
            .Options;

        return new DbaccManegmentContext(options);
    }

    // ---------------------------------------------------------------- purchase orders

    private static (DbaccManegmentContext ctx, Guid[] ids) SeedPurchaseOrders(int count)
    {
        var ctx = NewContext();
        var ids = new Guid[count];

        for (var i = 0; i < count; i++)
        {
            ids[i] = Guid.NewGuid();
            ctx.PurchaseOrders.Add(new PurchaseOrder
            {
                Id = ids[i],
                SiteId = Guid.NewGuid(),
                FromSupplierId = Guid.NewGuid(),
                ToCompanyId = Guid.NewGuid(),
                Poid = $"ABC/PO/25-26/{i:D3}",
                IsApproved = false,
                IsDeleted = false,
                CreatedBy = Guid.NewGuid(),
                CreatedOn = DateTime.UtcNow,
            });
        }

        ctx.SaveChanges();
        ctx.ChangeTracker.Clear();
        return (ctx, ids);
    }

    [Fact]
    public async Task PurchaseOrderIsApproved_loads_only_the_requested_rows()
    {
        var (ctx, ids) = SeedPurchaseOrders(10);
        var repo = new PurchaseOrderRepo(ctx, configuration: null!);

        await repo.PurchaseOrderIsApproved(new POIsApprovedMasterModel
        {
            POList = new List<POIsApprovedModel>
            {
                new() { Id = ids[2], IsApproved = true },
                new() { Id = ids[7], IsApproved = true },
            }
        });

        // The regression guard. Under the old code this was 10 -- the whole table
        // was read into memory and every row marked modified.
        Assert.Equal(2, ctx.ChangeTracker.Entries<PurchaseOrder>().Count());
    }

    [Fact]
    public async Task PurchaseOrderIsApproved_applies_the_requested_values()
    {
        var (ctx, ids) = SeedPurchaseOrders(5);
        var repo = new PurchaseOrderRepo(ctx, configuration: null!);

        var response = await repo.PurchaseOrderIsApproved(new POIsApprovedMasterModel
        {
            POList = new List<POIsApprovedModel>
            {
                new() { Id = ids[1], IsApproved = true },
                new() { Id = ids[3], IsApproved = true },
            }
        });

        Assert.Equal(200, response.code);

        ctx.ChangeTracker.Clear();
        var rows = await ctx.PurchaseOrders.ToDictionaryAsync(p => p.Id, p => p.IsApproved);

        Assert.True(rows[ids[1]]);
        Assert.True(rows[ids[3]]);
        Assert.False(rows[ids[0]]);
        Assert.False(rows[ids[2]]);
        Assert.False(rows[ids[4]]);
    }

    [Fact]
    public async Task PurchaseOrderIsApproved_can_unapprove()
    {
        var (ctx, ids) = SeedPurchaseOrders(3);
        foreach (var po in ctx.PurchaseOrders) { po.IsApproved = true; }
        await ctx.SaveChangesAsync();
        ctx.ChangeTracker.Clear();

        var repo = new PurchaseOrderRepo(ctx, configuration: null!);

        await repo.PurchaseOrderIsApproved(new POIsApprovedMasterModel
        {
            POList = new List<POIsApprovedModel> { new() { Id = ids[1], IsApproved = false } }
        });

        ctx.ChangeTracker.Clear();
        var rows = await ctx.PurchaseOrders.ToDictionaryAsync(p => p.Id, p => p.IsApproved);

        Assert.False(rows[ids[1]]);
        Assert.True(rows[ids[0]]);
        Assert.True(rows[ids[2]]);
    }

    [Fact]
    public async Task PurchaseOrderIsApproved_with_an_empty_list_touches_nothing()
    {
        var (ctx, _) = SeedPurchaseOrders(6);
        var repo = new PurchaseOrderRepo(ctx, configuration: null!);

        await repo.PurchaseOrderIsApproved(new POIsApprovedMasterModel
        {
            POList = new List<POIsApprovedModel>()
        });

        // Under the old code an empty request still rewrote all 6 rows.
        Assert.Empty(ctx.ChangeTracker.Entries<PurchaseOrder>());
    }

    [Fact]
    public async Task PurchaseOrderIsApproved_ignores_ids_that_do_not_exist()
    {
        var (ctx, ids) = SeedPurchaseOrders(4);
        var repo = new PurchaseOrderRepo(ctx, configuration: null!);

        var response = await repo.PurchaseOrderIsApproved(new POIsApprovedMasterModel
        {
            POList = new List<POIsApprovedModel>
            {
                new() { Id = ids[0], IsApproved = true },
                new() { Id = Guid.NewGuid(), IsApproved = true },   // not in the table
            }
        });

        Assert.Equal(200, response.code);
        Assert.Single(ctx.ChangeTracker.Entries<PurchaseOrder>());

        ctx.ChangeTracker.Clear();
        Assert.True((await ctx.PurchaseOrders.SingleAsync(p => p.Id == ids[0])).IsApproved);
    }

    // ---------------------------------------------------------------- suppliers

    private static (DbaccManegmentContext ctx, Guid[] ids) SeedSuppliers(int count)
    {
        var ctx = NewContext();
        var ids = new Guid[count];

        for (var i = 0; i < count; i++)
        {
            ids[i] = Guid.NewGuid();
            ctx.SupplierMasters.Add(new SupplierMaster
            {
                SupplierId = ids[i],
                SupplierName = $"Supplier {i}",
                Area = "Test Area",       // non-nullable in the model
                State = 1,
                City = 1,
                IsApproved = false,
                IsDelete = false,
                CreatedBy = Guid.NewGuid(),
                CreatedOn = DateTime.UtcNow,
            });
        }

        ctx.SaveChanges();
        ctx.ChangeTracker.Clear();
        return (ctx, ids);
    }

    [Fact]
    public async Task MultipleSupplierIsApproved_loads_only_the_requested_rows()
    {
        var (ctx, ids) = SeedSuppliers(8);
        var repo = new SupplierMasterRepo(ctx);

        await repo.MultipleSupplierIsApproved(new SupplierIsApprovedMasterModel
        {
            SupplierList = new List<SupplierIsApprovedModel>
            {
                new() { SupplierId = ids[4], IsApproved = true },
            }
        });

        // Was 8 under the old code.
        Assert.Single(ctx.ChangeTracker.Entries<SupplierMaster>());
    }

    [Fact]
    public async Task MultipleSupplierIsApproved_treats_a_null_flag_as_false()
    {
        var (ctx, ids) = SeedSuppliers(3);
        foreach (var s in ctx.SupplierMasters) { s.IsApproved = true; }
        await ctx.SaveChangesAsync();
        ctx.ChangeTracker.Clear();

        var repo = new SupplierMasterRepo(ctx);

        // SupplierMaster.IsApproved is non-nullable but the request model's is bool?.
        // The repository coerces null to false with `?? false`; this pins that down.
        await repo.MultipleSupplierIsApproved(new SupplierIsApprovedMasterModel
        {
            SupplierList = new List<SupplierIsApprovedModel>
            {
                new() { SupplierId = ids[1], IsApproved = null },
            }
        });

        ctx.ChangeTracker.Clear();
        Assert.False((await ctx.SupplierMasters.SingleAsync(s => s.SupplierId == ids[1])).IsApproved);
    }
}
