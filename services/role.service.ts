import api from '../utils/api';

export type DataScopeCode =
  | 'all'
  | 'own_customers'
  | 'team_customers'
  | 'finance_visible'
  | 'warehouse_visible'
  | 'procurement_visible';

export interface AuthPermission {
  code: string;
  resource: string;
  action: string;
  label: string;
  description?: string | null;
  group?: string;
  permissionGroup?: string;
}

export interface AuthRole {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  dataScopes: DataScopeCode[];
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveRoleInput {
  code?: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  dataScopes?: DataScopeCode[];
  permissions: string[];
}

export const roleService = {
  async listRoles(): Promise<AuthRole[]> {
    const response = await api.get<any, { success: boolean; data: AuthRole[] }>('/roles');
    return response.data || [];
  },

  async listPermissions(): Promise<AuthPermission[]> {
    const response = await api.get<any, { success: boolean; data: AuthPermission[] }>('/roles/permissions');
    return response.data || [];
  },

  async createRole(input: SaveRoleInput): Promise<AuthRole> {
    const response = await api.post<any, { success: boolean; data: AuthRole }>('/roles', input);
    return response.data;
  },

  async updateRole(code: string, input: SaveRoleInput): Promise<AuthRole> {
    const response = await api.put<any, { success: boolean; data: AuthRole }>(`/roles/${code}`, input);
    return response.data;
  },
};

export default roleService;
