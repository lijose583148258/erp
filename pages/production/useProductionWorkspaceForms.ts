import { useMemo, useState, type SetStateAction } from 'react';
import type { BomItemDraft } from './productionBomLineModel';
import {
  TEMPLATES,
  newBomItems,
  type BomLifecycleStatus,
  type BomType,
  type StepDraft,
} from './productionWorkspaceConfig';

const useTouchedState = () => {
  const [touched, setTouched] = useState(false);
  return {
    touched,
    markTouched: () => setTouched(true),
    clearTouched: () => setTouched(false),
  };
};

export const useProductionBomForm = () => {
  const touch = useTouchedState();
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
    setBomProductName: (value: string) => {
      touch.markTouched();
      setBomProductName(value);
    },
    bomVersion,
    setBomVersion: (value: string) => {
      touch.markTouched();
      setBomVersion(value);
    },
    bomType,
    setBomType: (value: BomType) => {
      touch.markTouched();
      setBomType(value);
    },
    bomStatus,
    setBomStatus: (value: BomLifecycleStatus) => {
      touch.markTouched();
      setBomStatus(value);
    },
    bomFormulationMode,
    setBomFormulationMode: (value: string) => {
      touch.markTouched();
      setBomFormulationMode(value);
    },
    bomOutputUnit,
    setBomOutputUnit: (value: string) => {
      touch.markTouched();
      setBomOutputUnit(value);
    },
    bomStandardBatchSize,
    setBomStandardBatchSize: (value: string) => {
      touch.markTouched();
      setBomStandardBatchSize(value);
    },
    bomBatchSizeUnit,
    setBomBatchSizeUnit: (value: string) => {
      touch.markTouched();
      setBomBatchSizeUnit(value);
    },
    bomDensity,
    setBomDensity: (value: string) => {
      touch.markTouched();
      setBomDensity(value);
    },
    bomSolidContent,
    setBomSolidContent: (value: string) => {
      touch.markTouched();
      setBomSolidContent(value);
    },
    bomEffectiveFrom,
    setBomEffectiveFrom: (value: string) => {
      touch.markTouched();
      setBomEffectiveFrom(value);
    },
    bomEffectiveTo,
    setBomEffectiveTo: (value: string) => {
      touch.markTouched();
      setBomEffectiveTo(value);
    },
    bomProcessText,
    setBomProcessText: (value: string) => {
      touch.markTouched();
      setBomProcessText(value);
    },
    bomQualitySpecText,
    setBomQualitySpecText: (value: string) => {
      touch.markTouched();
      setBomQualitySpecText(value);
    },
    bomNotes,
    setBomNotes: (value: string) => {
      touch.markTouched();
      setBomNotes(value);
    },
    bomItems,
    setBomItems: (value: SetStateAction<BomItemDraft[]>) => {
      touch.markTouched();
      setBomItems(value);
    },
    resetBomForm,
    touched: touch.touched,
    markTouched: touch.markTouched,
    clearTouched: touch.clearTouched,
  };
};

export const useProductionWorkOrderForm = (createInitialSteps: () => StepDraft[]) => {
  const touch = useTouchedState();
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
    setWoProductName: (value: string) => {
      touch.markTouched();
      setWoProductName(value);
    },
    setWoProductNameSilently: setWoProductName,
    woTargetQuantity,
    setWoTargetQuantity: (value: string) => {
      touch.markTouched();
      setWoTargetQuantity(value);
    },
    woProducedQuantity,
    setWoProducedQuantity: (value: string) => {
      touch.markTouched();
      setWoProducedQuantity(value);
    },
    woLossQuantity,
    setWoLossQuantity: (value: string) => {
      touch.markTouched();
      setWoLossQuantity(value);
    },
    woPlannedStartAt,
    setWoPlannedStartAt: (value: string) => {
      touch.markTouched();
      setWoPlannedStartAt(value);
    },
    woPlannedEndAt,
    setWoPlannedEndAt: (value: string) => {
      touch.markTouched();
      setWoPlannedEndAt(value);
    },
    woNote,
    setWoNote: (value: string) => {
      touch.markTouched();
      setWoNote(value);
    },
    woSteps,
    setWoSteps: (value: SetStateAction<StepDraft[]>) => {
      touch.markTouched();
      setWoSteps(value);
    },
    resetWoForm,
    touched: touch.touched,
    markTouched: touch.markTouched,
    clearTouched: touch.clearTouched,
  };
};

export const useProductionQualityForm = () => {
  const touch = useTouchedState();
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
    setQcResult: (value: 'pass' | 'fail') => {
      touch.markTouched();
      setQcResult(value);
    },
    qcDefectRate,
    setQcDefectRate: (value: string) => {
      touch.markTouched();
      setQcDefectRate(value);
    },
    qcNote,
    setQcNote: (value: string) => {
      touch.markTouched();
      setQcNote(value);
    },
    qcCheckedBy,
    setQcCheckedBy: (value: string) => {
      touch.markTouched();
      setQcCheckedBy(value);
    },
    resetQualityForm,
    touched: touch.touched,
    markTouched: touch.markTouched,
    clearTouched: touch.clearTouched,
  };
};

export const useProductionAdjustmentForm = () => {
  const touch = useTouchedState();
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
    setTemplateId: (value: string) => {
      touch.markTouched();
      setTemplateId(value);
    },
    adjustmentQuantity,
    setAdjustmentQuantity: (value: string) => {
      touch.markTouched();
      setAdjustmentQuantity(value);
    },
    adjustmentReason,
    setAdjustmentReason: (value: string) => {
      touch.markTouched();
      setAdjustmentReason(value);
    },
    adjustmentNote,
    setAdjustmentNote: (value: string) => {
      touch.markTouched();
      setAdjustmentNote(value);
    },
    touched: touch.touched,
    markTouched: touch.markTouched,
    clearTouched: touch.clearTouched,
  };
};
