const parseCsv = (value: string | undefined) => (
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

export const bomGridFeatureFlags = {
  labEnabled: import.meta.env.VITE_BOM_GRID_LAB_ENABLED === 'true',
  labUserIds: parseCsv(import.meta.env.VITE_BOM_GRID_LAB_USER_IDS),
  v2Enabled: import.meta.env.VITE_BOM_GRID_V2_ENABLED === 'true',
  v2UserIds: parseCsv(import.meta.env.VITE_BOM_GRID_V2_USER_IDS),
  v2AllUsers: import.meta.env.VITE_BOM_GRID_V2_ALL_USERS === 'true',
} as const;

type BomGridFeatureUser = {
  id?: string | number | null;
  role?: string | null;
};

export const canUseBomGridLab = (user: BomGridFeatureUser | null | undefined) => (
  bomGridFeatureFlags.labEnabled
  && (
    user?.role === 'admin'
    || bomGridFeatureFlags.labUserIds.includes(String(user?.id ?? ''))
  )
);

export const canUseBomGridV2 = (userId: string | number | null | undefined) => (
  bomGridFeatureFlags.v2Enabled
  && (
    bomGridFeatureFlags.v2AllUsers
    || bomGridFeatureFlags.v2UserIds.includes(String(userId ?? ''))
  )
);
