import enRaw from './en-US.json?raw';
import viRaw from './vi-VN.json?raw';
import zhRaw from './zh-CN.json?raw';
import type { Language } from '../../types';
import type { LabelMap } from '../../components/operatingTable/BusinessCells';

const parseLabels = (raw: string): LabelMap => JSON.parse(raw) as LabelMap;

const LABELS: Record<Language, LabelMap> = {
  zh: parseLabels(zhRaw),
  en: parseLabels(enRaw),
  vi: parseLabels(viRaw),
};

export const getOperatingTableLabels = (language: Language): LabelMap => LABELS[language] || LABELS.zh;
