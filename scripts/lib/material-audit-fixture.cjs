async function ensureReleasedMaterial({
  request,
  code,
  name,
  unit = 'kg',
  category = 'raw_material',
  shelfLifeDays = 365,
}) {
  // MaterialMasterService stores codes as trim().toUpperCase(). Match that
  // identity before lookup as well as creation, including repeated fixture use.
  const normalizedCode = String(code || '').trim().toUpperCase();
  const query = await request(`/materials?q=${encodeURIComponent(normalizedCode)}&status=active&limit=20`);
  if (!query.ok) {
    throw new Error(`material fixture query failed: ${query.status} ${JSON.stringify(query.json)}`);
  }
  const data = query.json?.data;
  const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const existing = rows.find(item => String(item.code) === normalizedCode);
  if (existing) return existing;

  const created = await request('/materials', {
    method: 'POST',
    data: {
      code: normalizedCode,
      nameZh: name,
      nameEn: name,
      nameVi: name,
      category,
      baseUnit: unit,
      specification: 'Enterprise audit fixture',
      status: 'active',
      isTemporary: false,
      shelfLifeDays,
      complianceNotes: 'Synthetic audit fixture; not production master data.',
      aliases: [],
    },
  });
  if (!created.ok) {
    throw new Error(`material fixture create failed: ${created.status} ${JSON.stringify(created.json)}`);
  }
  const material = created.json?.data;
  if (!material?.id) throw new Error('material fixture create returned no id');
  return material;
}

async function selectMaterialCombobox(page, testId, searchText, expectedText = searchText) {
  const input = page.locator(`[data-testid="${testId}"]`);
  await input.fill(searchText);
  const option = page.locator('[role="option"]').filter({ hasText: expectedText }).first();
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click();
}

module.exports = { ensureReleasedMaterial, selectMaterialCombobox };
