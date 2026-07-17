import { assertSafeSpreadsheetFile } from './spreadsheetSecurity';

type CellValue = string | number | boolean | Date | null | undefined;

const safeSheetName = (value?: string) => {
  const name = (value || 'Sheet1').replace(/[\\/*?:[\]]/g, ' ').trim() || 'Sheet1';
  return name.slice(0, 31);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
};

export const parseCsvText = (text: string): string[][] => text
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map(parseCsvLine);

const normalizeExcelCell = (value: unknown): unknown => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text || '');
  if (typeof value === 'object' && 'result' in value) return String((value as { result?: unknown }).result || '');
  return value;
};

export const parseSpreadsheetFileAsRows = async (file: File): Promise<unknown[][]> => {
  const extension = assertSafeSpreadsheetFile(file);
  if (extension === 'csv') return parseCsvText(await file.text());

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map(normalizeExcelCell));
  });
  return rows;
};

export const parseSpreadsheetFileAsObjects = async (file: File): Promise<Record<string, unknown>[]> => {
  const rows = await parseSpreadsheetFileAsRows(file);
  const [headerRow] = rows;
  if (!headerRow) return [];
  const headers = headerRow.map((header, index) => String(header || `Column ${index + 1}`).trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? '';
    });
    return record;
  });
};

export const exportRowsToXlsx = async (
  rows: CellValue[][],
  filename: string,
  sheetName?: string,
) => {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(safeSheetName(sheetName));
  rows.forEach((row) => worksheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), filename);
};

export const exportObjectsToXlsx = async (
  rows: Record<string, unknown>[],
  filename: string,
  sheetName?: string,
) => {
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const dataRows = rows.map((row) => headers.map((header) => row[header] as CellValue));
  await exportRowsToXlsx([headers, ...dataRows], filename, sheetName);
};
