import { useMemo, useState } from 'react';
import { type BomItemDraft } from './ProductionBomLineGrid';
import {
  TEMPLATES,
  newBomItems,
  type BomLifecycleStatus,
  type BomType,
  type StepDraft,
} from './productionWorkspaceConfig';

export const useProductionBomForm = () => {
  const [bomProductName, setBomProductName] = useState('');
  const [bomVersion, setBomVersion] = useState('v1');
  const [bomType, setBomType] = useState<BomType>('standard');
  const [bomStatus, setBomStatus] = useState<BomLifecycleStatus>('draft');
  const [bomFormulationMode, setBomFormulationMode] = useState('fixed');
  const [bomOutputUnit, setBomOutputUnit] = useState('kg');
  const [bomStandardBatchSize, setBomStandardBatchSize] = useState('');
  const [bomBatchSizeUnit, setBomBatchSizeUnit] = useState('kg');
  const [bomDensity, setBomDensity] = useState('');
  const [bomSolidContent, setBomSolidContent] = useState('');
  const [bomEffectiveFrom, setBomEffectiveFrom] = useState('');
  const [bomEffectiveTo, setBomEffectiveTo] = useState('');
  const [bomProcessText, setBomProcessText] = useState('');
  const [bomQualitySpecText, setBomQualitySpecText] = useState('');
  const [bomNotes, setBomNotes] = useState('');
  const [bomItems, setBomItems] = useState<BomItemDraft[]>(newBomItems());

  const resetBomForm = () => {
    setBomProductName('');
    setBomVersion('v1');
    setBomType('standard');
    setBomStatus('draft');
    setBomFormulationMode('fixed');
    setBomOutputUnit('kg');
    setBomStandardBatchSize('');
    setBomBatchSizeUnit('kg');
    setBomDensity('');
    setBomSolidContent('');
    setBomEffectiveFrom('');
    setBomEffectiveTo('');
    setBomProcessText('');
    setBomQualitySpecText('');
    setBomNotes('');
    setBomItems(newBomItems());
  };

  return {
    bomProductName,
    setBomProductName,
    bomVersion,
    setBomVersion,
    bomType,
    setBomType,
    bomStatus,
    setBomStatus,
    bomFormulationMode,
    setBomFormulationMode,
    bomOutputUnit,
    setBomOutputUnit,
    bomStandardBatchSize,
    setBomStandardBatchSize,
    bomBatchSizeUnit,
    setBomBatchSizeUnit,
    bomDensity,
    setBomDensity,
    bomSolidContent,
    setBomSolidContent,
    bomEffectiveFrom,
    setBomEffectiveFrom,
    bomEffectiveTo,
    setBomEffectiveTo,
    bomProcessText,
    setBomProcessText,
    bomQualitySpecText,
    setBomQualitySpecText,
    bomNotes,
    setBomNotes,
    bomItems,
    setBomItems,
    resetBomForm,
  };
};

export const useProductionWorkOrderForm = (createInitialSteps: () => StepDraft[]) => {
  const [woProductName, setWoProductName] = useState('');
  const [woTargetQuantity, setWoTargetQuantity] = useState('');
  const [woProducedQuantity, setWoProducedQuantity] = useState('');
  const [woLossQuantity, setWoLossQuantity] = useState('');
  const [woPlannedStartAt, setWoPlannedStartAt] = useState('');
  const [woPlannedEndAt, setWoPlannedEndAt] = useState('');
  const [woNote, setWoNote] = useState('');
  const [woSteps, setWoSteps] = useState<StepDraft[]>(() => createInitialSteps());

  const resetWoForm = () => {
    setWoProductName('');
    setWoTargetQuantity('');
    setWoProducedQuantity('');
    setWoLossQuantity('');
    setWoPlannedStartAt('');
    setWoPlannedEndAt('');
    setWoNote('');
    setWoSteps(createInitialSteps());
  };

  return {
    woProductName,
    setWoProductName,
    woTargetQuantity,
    setWoTargetQuantity,
    woProducedQuantity,
    setWoProducedQuantity,
    woLossQuantity,
    setWoLossQuantity,
    woPlannedStartAt,
    setWoPlannedStartAt,
    woPlannedEndAt,
    setWoPlannedEndAt,
    woNote,
    setWoNote,
    woSteps,
    setWoSteps,
    resetWoForm,
  };
};

export const useProductionQualityForm = () => {
  const [qcResult, setQcResult] = useState<'pass' | 'fail'>('pass');
  const [qcDefectRate, setQcDefectRate] = useState('');
  const [qcNote, setQcNote] = useState('');
  const [qcCheckedBy, setQcCheckedBy] = useState('');

  const resetQualityForm = () => {
    setQcResult('pass');
    setQcDefectRate('');
    setQcNote('');
    setQcCheckedBy('');
  };

  return {
    qcResult,
    setQcResult,
    qcDefectRate,
    setQcDefectRate,
    qcNote,
    setQcNote,
    qcCheckedBy,
    setQcCheckedBy,
    resetQualityForm,
  };
};

export const useProductionAdjustmentForm = () => {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState(TEMPLATES[0].reason);
  const [adjustmentNote, setAdjustmentNote] = useState('');

  const selectedTemplate = useMemo(
    () => TEMPLATES.find(item => item.id === templateId) || TEMPLATES[0],
    [templateId],
  );

  return {
    selectedTemplate,
    templateId,
    setTemplateId,
    adjustmentQuantity,
    setAdjustmentQuantity,
    adjustmentReason,
    setAdjustmentReason,
    adjustmentNote,
    setAdjustmentNote,
  };
};
