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
  const fileType = file.name.split('.').pop()?.toLowerCase();

  if (fileType === 'csv') return parseCSV(file);
  if (fileType === 'xlsx' || fileType === 'xls') return parseExcel(file);

  throw new Error('不支持的文件格式，请上传 CSV 或 Excel 文件。');
};

const parseCSV = async (file: File): Promise<TableData> => {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length === 0) {
    throw new Error('文件为空，未读取到表头或数据行。');
  }

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCSVLine(line));

  return buildTableData(headers, rows, file, 'csv');
};

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
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

const parseExcel = async (file: File): Promise<TableData> => {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('工作簿没有可读取的工作表。');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  if (rawRows.length === 0) {
    throw new Error('工作表为空，未读取到表头或数据行。');
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
