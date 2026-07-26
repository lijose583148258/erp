const parseCsv = (value: string | undefined) => (
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

export const bomGridFeatureFlags = {
  labEnabled: import.meta.env.DEV || import.meta.env.VITE_BOM_GRID_LAB_ENABLED === 'true',
  v2Enabled: import.meta.env.VITE_BOM_GRID_V2_ENABLED === 'true',
  v2UserIds: parseCsv(import.meta.env.VITE_BOM_GRID_V2_USER_IDS),
} as const;

export const canUseBomGridV2 = (userId: string | number | null | undefined) => (
  bomGridFeatureFlags.v2Enabled
  && (bomGridFeatureFlags.v2UserIds.length === 0 || bomGridFeatureFlags.v2UserIds.includes(String(userId ?? '')))
);
