import { assertSafeSpreadsheetFile } from '../utils/spreadsheetSecurity';
import { parseCsvText, parseSpreadsheetFileAsRows } from '../utils/spreadsheetIO';

export interface TableData {
  headers: string[];
  rows: string[][];
  metadata?: {
    fileName?: string;
    fileType?: string;
    rowCount?: number;
    columnCount?: number;
  };
}

export const parseTableFile = async (file: File): Promise<TableData> => {
  const fileType = assertSafeSpreadsheetFile(file);
  if (fileType === 'csv') return parseCSV(file);
  if (fileType === 'xlsx' || fileType === 'xls') return parseExcel(file);
  throw new Error('Unsupported file type. Upload CSV, XLS, or XLSX only.');
};

const parseCSV = async (file: File): Promise<TableData> => {
  const rows = parseCsvText(await file.text());
  if (rows.length === 0) {
    throw new Error('The file is empty.');
  }
  return buildTableData(rows[0].map((header) => String(header || '').trim()), rows.slice(1), file, 'csv');
};

const parseExcel = async (file: File): Promise<TableData> => {
  const rawRows = await parseSpreadsheetFileAsRows(file);
  if (rawRows.length === 0) {
    throw new Error('The workbook does not contain readable rows.');
  }

  const headers = rawRows[0].map((header) => String(header || '').trim());
  const rows = rawRows.slice(1).map((row) =>
    row.map((cell) => (cell === undefined || cell === null ? '' : String(cell).trim())),
  );

  return buildTableData(headers, rows, file, 'excel');
};

const buildTableData = (
  headers: string[],
  rows: string[][],
  file: File,
  fileType: 'csv' | 'excel',
): TableData => ({
  headers,
  rows,
  metadata: {
    fileName: file.name,
    fileType,
    rowCount: rows.length,
    columnCount: headers.length,
  },
});
