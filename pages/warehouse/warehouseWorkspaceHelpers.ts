import type { Warehouse as WarehouseType } from '../../services/warehouse.service';
import type { WarehouseLocationOption } from './warehouseWorkspaceTypes';

export const summarizeWarehouses = (warehouses: WarehouseType[]) => ({
  totalItems: warehouses.reduce((sum, warehouse) => sum + (warehouse._summary?.totalItems || 0), 0),
  totalQuantity: warehouses.reduce((sum, warehouse) => sum + (warehouse._summary?.totalQuantity || 0), 0),
  totalLocations: warehouses.reduce((sum, warehouse) => sum + warehouse.locations.length, 0),
});

export const flattenWarehouseLocations = (warehouses: WarehouseType[]): WarehouseLocationOption[] =>
  warehouses.flatMap(warehouse =>
    warehouse.locations.map(location => ({
      ...location,
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
    }))
  );

export const filterWarehouseLocations = (
  locations: WarehouseLocationOption[],
  warehouseId: string,
) => (warehouseId ? locations.filter(location => String(location.warehouseId) === warehouseId) : locations);
