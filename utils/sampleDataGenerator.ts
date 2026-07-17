/**
 * 生成测试用的示例表格数据
 * 用于演示智能表格识别功能
 */
import { reportClientIssue } from './clientIssue';
import { exportRowsToXlsx } from './spreadsheetIO';

// 客户信息示例数据
export const sampleCustomerData = [
  ['客户名称', '联系人', '电话', '邮箱', '地址', '信用额度', '账期', '营业执照'],
  ['上海化工有限公司', '张三', '13800138000', 'zhangsan@shchemical.com', '上海市浦东新区张江高科技园区', '1000000', '30天', '91310000MA1234567A'],
  ['北京贸易集团', '李四', '13900139000', 'lisi@bjtrading.com', '北京市朝阳区建国路88号', '500000', '60天', '91110000MA7654321B'],
  ['广州石化公司', '王五', '13700137000', 'wangwu@gzpetro.com', '广州市天河区珠江新城', '800000', '45天', '91440000MA9876543C'],
  ['深圳材料科技', '赵六', '13600136000', 'zhaoliu@szmaterial.com', '深圳市南山区科技园', '1200000', '30天', '91440300MA5432109D'],
  ['成都化学工业', '钱七', '13500135000', 'qianqi@cdchem.com', '成都市高新区天府大道', '600000', '90天', '91510000MA1357924E']
];

// 销售订单示例数据（包含生物科技字段）
export const sampleOrderData = [
  ['客户名称', '产品名称', 'CAS号', '纯度', '批次号', '等级', '数量', '单位', '单价', '金额', '币种', '账期', '交货日期'],
  ['上海化工有限公司', '聚乙烯 HD-5000', '9002-88-4', '99.9%', 'BATCH-2026-001', '工业级', '100', '吨', '8500', '850000', 'CNY', '30天', '2026-03-01'],
  ['北京贸易集团', '聚丙烯 PP-3000', '9003-07-0', '99.5%', 'BATCH-2026-002', '食品级', '50', '吨', '9000', '450000', 'CNY', '60天', '2026-03-15'],
  ['广州石化公司', '聚氯乙烯 PVC-7000', '9002-86-2', '99.8%', 'BATCH-2026-003', '医用级', '80', '吨', '7200', '576000', 'CNY', '45天', '2026-03-10'],
  ['深圳材料科技', 'PET树脂 PET-8000', '25038-59-9', '99.9%', 'BATCH-2026-004', '电子级', '120', '吨', '10500', '1260000', 'CNY', '30天', '2026-02-28'],
  ['成都化学工业', '聚苯乙烯 PS-4000', '9003-53-6', '99.7%', 'BATCH-2026-005', '通用级', '60', '吨', '8800', '528000', 'CNY', '90天', '2026-03-20']
];

// 样品申请示例数据
export const sampleSampleData = [
  ['客户名称', '样品名称', '规格', '数量', '重量', '收货地址', '联系人', '联系电话'],
  ['上海化工有限公司', '聚乙烯样品', 'HD-5000', '2', '5kg', '上海市浦东新区张江高科技园区研发中心', '张三', '13800138000'],
  ['北京贸易集团', '聚丙烯样品', 'PP-3000', '1', '3kg', '北京市朝阳区建国路88号实验室', '李四', '13900139000'],
  ['广州石化公司', 'PVC样品', 'PVC-7000', '3', '8kg', '广州市天河区珠江新城质检部', '王五', '13700137000'],
  ['深圳材料科技', 'PET样品', 'PET-8000', '2', '6kg', '深圳市南山区科技园测试中心', '赵六', '13600136000'],
  ['成都化学工业', 'PS样品', 'PS-4000', '1', '4kg', '成都市高新区天府大道技术部', '钱七', '13500135000']
];

// 物流信息示例数据
export const sampleShipmentData = [
  ['运单号', '客户名称', '订单号', '承运商', '发货日期', '预计送达', '状态'],
  ['SF1234567890', '上海化工有限公司', 'SO-2026-001', '顺丰速运', '2026-02-10', '2026-02-12', '在途'],
  ['YT9876543210', '北京贸易集团', 'SO-2026-002', '圆通速递', '2026-02-11', '2026-02-14', '已发货'],
  ['ZTO5678901234', '广州石化公司', 'SO-2026-003', '中通快递', '2026-02-09', '2026-02-13', '已签收'],
  ['STO3456789012', '深圳材料科技', 'SO-2026-004', '申通快递', '2026-02-12', '2026-02-15', '派送中'],
  ['EMS7890123456', '成都化学工业', 'SO-2026-005', 'EMS快递', '2026-02-08', '2026-02-16', '在途']
];

/**
 * 将数据转换为CSV格式
 */
export const convertToCSV = (data: string[][]): string => {
  return data.map(row => 
    row.map(cell => {
      // 如果包含逗号或引号，需要用引号包裹
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
};

/**
 * 下载CSV文件
 */
export const downloadCSV = (data: string[][], filename: string) => {
  const csv = convertToCSV(data);
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * 下载Excel文件（需要xlsx库）
 */
export const downloadExcel = async (data: string[][], filename: string) => {
  try {
    await exportRowsToXlsx(data, filename, 'Sheet1');
  } catch (error) {
    reportClientIssue('sample-excel-export', error, 'warning');
    downloadCSV(data, filename.replace('.xlsx', '.csv'));
  }
};

/**
 * 生成所有示例文件
 */
export const generateAllSampleFiles = () => {
  downloadCSV(sampleCustomerData, '客户信息示例.csv');
  downloadCSV(sampleOrderData, '销售订单示例.csv');
  downloadCSV(sampleSampleData, '样品申请示例.csv');
  downloadCSV(sampleShipmentData, '物流信息示例.csv');
};

export default {
  sampleCustomerData,
  sampleOrderData,
  sampleSampleData,
  sampleShipmentData,
  convertToCSV,
  downloadCSV,
  downloadExcel,
  generateAllSampleFiles
};
