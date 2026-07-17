import { buildCustomerListFilters, resolveCustomerListQuery } from './customer-query.service';

describe('CustomerQueryService query helpers', () => {
  it('normalizes pagination and caps page size', () => {
    expect(resolveCustomerListQuery({ page: '-1', pageSize: '999', sortBy: 'name', sortOrder: 'asc' })).toMatchObject({
      page: 1,
      pageSize: 100,
      offset: 0,
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(resolveCustomerListQuery({ page: '3', pageSize: '30', sortBy: 'unknown', sortOrder: 'sideways' })).toMatchObject({
      page: 3,
      pageSize: 30,
      offset: 60,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('builds customer list filters without owning access scope', async () => {
    const filters = await buildCustomerListFilters({
      search: 'Acme',
      status: 'active',
      riskLevel: 'high',
      segment: 'direct',
      viewMode: 'my',
      salespersonId: '7',
    });

    expect(filters).toMatchObject({
      status: 'active',
      riskLevel: 'high',
      segment: 'direct',
      NOT: { poolState: 'public' },
      salespersonId: 7,
    });
    expect(filters.OR).toContainEqual({ name: { contains: 'Acme' } });
    expect(filters).not.toHaveProperty('AND');
  });
});
