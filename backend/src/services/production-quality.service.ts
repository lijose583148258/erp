import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import type { ProductionQualityCheckInput } from './production-query.service';
import type { TransactionClient } from './stock-movement.service';

export type ProductionQualityActor = {
  userId: number;
  username: string;
};

const normalizeText = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();

const evaluateText = (measured: string, target: string | null) => {
  const actual = normalizeText(measured);
  if (!actual) return false;
  const accepted = String(target || '')
    .split('|')
    .map(normalizeText)
    .filter(Boolean);
  return accepted.length === 0 || accepted.includes(actual);
};

const evaluateNumeric = (
  measured: Prisma.Decimal,
  lower: Prisma.Decimal | null,
  upper: Prisma.Decimal | null,
) => (!lower || measured.greaterThanOrEqualTo(lower)) && (!upper || measured.lessThanOrEqualTo(upper));

export async function assertLatestQualityRelease(
  tx: TransactionClient,
  workOrderId: number,
  specificationCount: number,
) {
  if (specificationCount <= 0) return;
  const latestInspection = await tx.productionQualityCheck.findFirst({
    where: { workOrderId },
    orderBy: { revision: 'desc' },
    select: { status: true, result: true },
  });
  if (!latestInspection || latestInspection.status !== 'released' || latestInspection.result !== 'pass') {
    throw new Error('WORK_ORDER_QUALITY_RELEASE_REQUIRED');
  }
}

export class ProductionQualityService {
  static async submitInspection(
    workOrderId: number,
    input: ProductionQualityCheckInput,
    actor: ProductionQualityActor,
  ) {
    return prisma.$transaction(async tx => {
      const workOrder = await tx.productionWorkOrder.findUnique({
        where: { id: workOrderId },
        include: {
          bom: { include: { qualityCharacteristics: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } } },
          qualityChecks: { orderBy: { revision: 'desc' }, take: 1 },
        },
      });
      if (!workOrder) throw new Error(`WORK_ORDER_NOT_FOUND:${workOrderId}`);
      if (workOrder.status !== 'qc_pending') throw new Error(`QC_WORK_ORDER_STATUS_INVALID:${workOrder.status}`);

      const characteristics = workOrder.bom?.qualityCharacteristics || [];
      if (characteristics.length === 0) throw new Error('QC_SPECIFICATION_REQUIRED');
      const byId = new Map(characteristics.map(item => [item.id, item]));
      const submittedIds = input.measurements.map(item => item.characteristicId);
      if (new Set(submittedIds).size !== submittedIds.length) {
        throw new Error('QC_DUPLICATE_MEASUREMENT');
      }
      const submittedById = new Map(input.measurements.map(item => [item.characteristicId, item]));
      const unknownIds = [...submittedById.keys()].filter(id => !byId.has(id));
      if (unknownIds.length) throw new Error(`QC_CHARACTERISTIC_NOT_FOUND:${unknownIds.join(',')}`);
      const missingRequired = characteristics.filter(item => item.required && !submittedById.has(item.id));
      if (missingRequired.length) throw new Error(`QC_REQUIRED_MEASUREMENT_MISSING:${missingRequired.map(item => item.code).join(',')}`);

      const measurements = characteristics
        .filter(item => submittedById.has(item.id))
        .map(characteristic => {
          const submitted = submittedById.get(characteristic.id)!;
          if (characteristic.valueType === 'numeric') {
            if (submitted.measuredNumeric === null || submitted.measuredNumeric === undefined || submitted.measuredNumeric === '') {
              throw new Error(`QC_NUMERIC_VALUE_REQUIRED:${characteristic.code}`);
            }
            let measured: Prisma.Decimal;
            try {
              measured = new Prisma.Decimal(String(submitted.measuredNumeric));
            } catch {
              throw new Error(`QC_NUMERIC_VALUE_INVALID:${characteristic.code}`);
            }
            const passed = evaluateNumeric(measured, characteristic.lowerLimit, characteristic.upperLimit);
            return {
              characteristicId: characteristic.id,
              characteristicCode: characteristic.code,
              characteristicName: characteristic.name,
              valueType: characteristic.valueType,
              unit: characteristic.unit,
              lowerLimit: characteristic.lowerLimit,
              upperLimit: characteristic.upperLimit,
              targetText: characteristic.targetText,
              measuredNumeric: measured,
              measuredText: null,
              result: passed ? 'pass' : 'fail',
              testMethod: characteristic.testMethod,
              instrumentNo: submitted.instrumentNo || null,
              note: submitted.note || null,
            };
          }

          const measuredText = String(submitted.measuredText || '').trim();
          if (!measuredText) throw new Error(`QC_TEXT_VALUE_REQUIRED:${characteristic.code}`);
          const passed = evaluateText(measuredText, characteristic.targetText);
          return {
            characteristicId: characteristic.id,
            characteristicCode: characteristic.code,
            characteristicName: characteristic.name,
            valueType: characteristic.valueType,
            unit: characteristic.unit,
            lowerLimit: characteristic.lowerLimit,
            upperLimit: characteristic.upperLimit,
            targetText: characteristic.targetText,
            measuredNumeric: null,
            measuredText,
            result: passed ? 'pass' : 'fail',
            testMethod: characteristic.testMethod,
            instrumentNo: submitted.instrumentNo || null,
            note: submitted.note || null,
          };
        });

      const failedCount = measurements.filter(item => item.result === 'fail').length;
      const result = failedCount > 0 ? 'fail' : 'pass';
      const revision = (workOrder.qualityChecks[0]?.revision || 0) + 1;
      // The structured inspection is authoritative. Never allow a browser or
      // integration client to overwrite the server-derived failure ratio.
      const defectRate = measurements.length ? (failedCount / measurements.length) * 100 : null;

      const created = await tx.productionQualityCheck.create({
        data: {
          workOrderId,
          checkNo: `QC-${workOrder.workOrderNo}-R${revision}`,
          revision,
          status: 'submitted',
          result,
          disposition: 'hold',
          sampleNo: input.sampleNo,
          defectRate,
          note: input.note || null,
          inspectorUserId: actor.userId,
          checkedBy: actor.username,
          checkedAt: new Date(),
          measurements: { create: measurements },
        },
        include: { measurements: { orderBy: { id: 'asc' } } },
      });

      if (workOrder.batchId) {
        await tx.productBatch.update({ where: { id: workOrder.batchId }, data: { qualityStatus: 'hold' } });
      }
      return created;
    }, { isolationLevel: 'Serializable' });
  }

  static async reviewInspection(
    workOrderId: number,
    qualityCheckId: number,
    input: { decision: 'release' | 'reject'; reviewNote: string },
    actor: ProductionQualityActor,
  ) {
    return prisma.$transaction(async tx => {
      const inspection = await tx.productionQualityCheck.findFirst({
        where: { id: qualityCheckId, workOrderId },
        include: { workOrder: true, measurements: { orderBy: { id: 'asc' } } },
      });
      if (!inspection) throw new Error(`QC_INSPECTION_NOT_FOUND:${qualityCheckId}`);
      if (inspection.status !== 'submitted') throw new Error(`QC_REVIEW_STATUS_INVALID:${inspection.status}`);
      if (inspection.inspectorUserId === actor.userId) throw new Error('QC_SEGREGATION_OF_DUTIES_REQUIRED');
      const newer = await tx.productionQualityCheck.findFirst({
        where: { workOrderId, revision: { gt: inspection.revision } },
        select: { id: true },
      });
      if (newer) throw new Error('QC_REVIEW_STALE_REVISION');
      if (input.decision === 'release' && inspection.result !== 'pass') {
        throw new Error('QC_FAILED_INSPECTION_CANNOT_BE_RELEASED');
      }

      const released = input.decision === 'release';
      const claimed = await tx.productionQualityCheck.updateMany({
        where: { id: inspection.id, status: 'submitted' },
        data: {
          status: released ? 'released' : 'rejected',
          disposition: released ? 'released' : 'quarantine',
          reviewedByUserId: actor.userId,
          reviewedBy: actor.username,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote,
        },
      });
      if (claimed.count !== 1) throw new Error('QC_REVIEW_ALREADY_DECIDED');
      if (inspection.workOrder.batchId) {
        await tx.productBatch.update({
          where: { id: inspection.workOrder.batchId },
          data: { qualityStatus: released ? 'released' : 'quarantine' },
        });
      }
      const updated = await tx.productionQualityCheck.findUnique({
        where: { id: inspection.id },
        include: { measurements: { orderBy: { id: 'asc' } } },
      });
      if (!updated) throw new Error(`QC_INSPECTION_NOT_FOUND:${inspection.id}`);
      return updated;
    }, { isolationLevel: 'Serializable' });
  }
}
