import type ExcelJS from 'exceljs';

// ExcelJS' package entry eagerly loads its optional streaming writer and the
// Archiver ESM boundary. The ERP uses the document workbook API only, so load
// that API directly and keep server startup, Jest, and non-spreadsheet routes
// independent from the optional streaming implementation.
const SpreadsheetWorkbook = require('exceljs/lib/doc/workbook') as typeof ExcelJS.Workbook;

export default SpreadsheetWorkbook;
