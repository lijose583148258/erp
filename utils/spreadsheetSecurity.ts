const ALLOWED_SPREADSHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx']);
const DEFAULT_MAX_SPREADSHEET_BYTES = 2 * 1024 * 1024;

export const SPREADSHEET_SECURITY_NOTE =
  'Spreadsheet parsing uses ExcelJS with client-side extension and size limits before any workbook parsing.';

export const getSpreadsheetExtension = (fileName: string) => {
  const lastSegment = fileName.split(/[\\/]/).pop() || '';
  const extension = lastSegment.split('.').pop()?.toLowerCase() || '';
  return extension;
};

export const assertSafeSpreadsheetFile = (
  file: Pick<File, 'name' | 'size'>,
  options: { maxBytes?: number } = {},
) => {
  const extension = getSpreadsheetExtension(file.name);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SPREADSHEET_BYTES;

  if (!ALLOWED_SPREADSHEET_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported spreadsheet file type. Upload CSV, XLS, or XLSX only.');
  }

  if (file.size > maxBytes) {
    const maxMb = Math.max(1, Math.round(maxBytes / 1024 / 1024));
    throw new Error(`Spreadsheet file is too large. Upload a file up to ${maxMb} MB.`);
  }

  return extension as 'csv' | 'xls' | 'xlsx';
};
