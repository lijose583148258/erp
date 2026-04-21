import prisma from '../config/database';

export interface RuntimeDataRepairEntry {
  entity: string;
  id: number;
  action: 'updated' | 'skipped';
  fields: string[];
}

export interface RuntimeDataRepairReport {
  entries: RuntimeDataRepairEntry[];
}

const replacementChar = String.fromCharCode(65533);
const looksCorrupted = (value: unknown) =>
  typeof value === 'string' && (value.includes('?') || value.includes(replacementChar));

const pushEntry = (
  report: RuntimeDataRepairReport,
  entity: string,
  id: number,
  action: 'updated' | 'skipped',
  fields: string[],
) => {
  report.entries.push({ entity, id, action, fields });
};

const repairSupplier = async (report: RuntimeDataRepairReport, id: number, patch: Record<string, any>) => {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    pushEntry(report, 'supplier', id, 'skipped', ['missing']);
    return;
  }

  await prisma.supplier.update({
    where: { id },
    data: patch,
  });

  pushEntry(report, 'supplier', id, 'updated', Object.keys(patch));
};

const repairCustomer = async (report: RuntimeDataRepairReport, id: number, patch: Record<string, any>) => {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) {
    pushEntry(report, 'customer', id, 'skipped', ['missing']);
    return;
  }

  await prisma.customer.update({
    where: { id },
    data: patch,
  });

  pushEntry(report, 'customer', id, 'updated', Object.keys(patch));
};

const repairProductionBom = async (report: RuntimeDataRepairReport, id: number, patch: Record<string, any>) => {
  const bom = await prisma.productionBom.findUnique({ where: { id } });
  if (!bom) {
    pushEntry(report, 'productionBom', id, 'skipped', ['missing']);
    return;
  }

  await prisma.productionBom.update({
    where: { id },
    data: patch,
  });

  pushEntry(report, 'productionBom', id, 'updated', Object.keys(patch));
};

const repairProductionBomItem = async (report: RuntimeDataRepairReport, id: number, patch: Record<string, any>) => {
  const item = await prisma.productionBomItem.findUnique({ where: { id } });
  if (!item) {
    pushEntry(report, 'productionBomItem', id, 'skipped', ['missing']);
    return;
  }

  await prisma.productionBomItem.update({
    where: { id },
    data: patch,
  });

  pushEntry(report, 'productionBomItem', id, 'updated', Object.keys(patch));
};

const repairProductionWorkOrder = async (report: RuntimeDataRepairReport, id: number, patch: Record<string, any>) => {
  const workOrder = await prisma.productionWorkOrder.findUnique({ where: { id } });
  if (!workOrder) {
    pushEntry(report, 'productionWorkOrder', id, 'skipped', ['missing']);
    return;
  }

  await prisma.productionWorkOrder.update({
    where: { id },
    data: patch,
  });

  pushEntry(report, 'productionWorkOrder', id, 'updated', Object.keys(patch));
};

const repairProductionStep = async (report: RuntimeDataRepairReport, id: number, patch: Record<string, any>) => {
  const step = await prisma.productionProcessStep.findUnique({ where: { id } });
  if (!step) {
    pushEntry(report, 'productionProcessStep', id, 'skipped', ['missing']);
    return;
  }

  await prisma.productionProcessStep.update({
    where: { id },
    data: patch,
  });

  pushEntry(report, 'productionProcessStep', id, 'updated', Object.keys(patch));
};

export const repairRuntimeData = async (): Promise<RuntimeDataRepairReport> => {
  const report: RuntimeDataRepairReport = { entries: [] };

  await repairSupplier(report, 3, {
    nameZh: '烟测供应商0410',
    nameEn: 'Supplier Smoke 0410',
    nameVi: 'Nha cung cap Smoke 0410',
  });

  await repairSupplier(report, 5, {
    name: '爱牢达供应商总部',
    nameZh: '爱牢达供应商总部',
    nameEn: 'Ailao Supplier',
    nameVi: 'Nhà cung cấp Ailao',
    nameAliases: JSON.stringify(['Ailao Materials', 'ALD VN']),
    contactsJson: JSON.stringify([
      {
        position: '采购负责人',
        name: '李采购',
        phone: '13800138000',
        email: 'buyer@ailao.test',
        isPrimary: true,
        language: 'zh',
      },
    ]),
    addressesJson: JSON.stringify([
      {
        city: 'HCM',
        label: '法定主体 / Supplier HQ',
        fullAddress: '越南胡志明市工业园区88号',
        type: 'legal',
        isPrimary: true,
        countryCode: 'VN',
      },
    ]),
    category: '化工原料',
    contact: '李采购',
  });

  await repairSupplier(report, 15, {
    addressesJson: JSON.stringify([
      {
        city: 'HCM',
        label: '法定地址',
        fullAddress: 'API Address',
        type: 'legal',
        isPrimary: true,
        countryCode: 'VN',
      },
    ]),
  });

  await repairCustomer(report, 5, {
    name: '烟测客户 1775784935',
    nameZh: '烟测客户 1775784935',
    nameEn: 'UI Smoke Customer 1775784935',
    nameVi: 'Khách hàng smoke 1775784935',
  });

  await repairProductionBom(report, 1, {
    productName: '烟测产品A',
    outputUnit: 'kg',
    notes: '烟测BOM',
  });

  await repairProductionBomItem(report, 1, {
    materialName: '原料A',
    notes: '烟测BOM明细',
  });

  await repairProductionWorkOrder(report, 1, {
    productName: '烟测产品A',
    note: '烟测工单',
  });

  await repairProductionStep(report, 1, {
    title: '备料',
  });

  // ── 仓储默认数据（幂等确保主仓库+四个基础库位存在，否则完工扣料不可用） ──
  try {
    const mainWh = await prisma.warehouse.upsert({
      where: { code: 'WH-MAIN' },
      update: {
        name: '主仓库',
        type: 'physical',
        status: 'active',
      },
      create: {
        code: 'WH-MAIN',
        name: '主仓库',
        type: 'physical',
        status: 'active',
      },
    });

    const locationDefs = [
      { code: 'LOC-RAW', name: '原料区', type: 'internal' },
      { code: 'LOC-FG', name: '成品区', type: 'internal' },
      { code: 'LOC-WIP', name: '半成品区', type: 'production' },
      { code: 'LOC-SCRAP', name: '废料区', type: 'scrap' },
    ];

    for (const loc of locationDefs) {
      await prisma.location.upsert({
        where: { code: loc.code },
        update: {
          warehouseId: mainWh.id,
          name: loc.name,
          type: loc.type,
          status: 'active',
        },
        create: {
          warehouseId: mainWh.id,
          code: loc.code,
          name: loc.name,
          type: loc.type,
          status: 'active',
        },
      });
    }

    pushEntry(report, 'warehouse', mainWh.id, 'updated', ['ensured WH-MAIN with LOC-RAW/LOC-FG/LOC-WIP/LOC-SCRAP']);
  } catch {
    // 仓储表可能尚未建表（首次 schema repair 之前）；静默跳过
  }

  return report;
};
