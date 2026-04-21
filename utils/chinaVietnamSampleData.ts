/**
 * 中越贸易示例数据生成器
 * 包含越南语和中越混合数据
 */

// 越南语客户信息示例
export const vietnameseCustomerData = [
  ['Tên khách hàng', 'Người liên hệ', 'Điện thoại', 'Email', 'Địa chỉ', 'Mã số thuế', 'Hạn mức tín dụng'],
  ['Công ty TNHH Hóa chất ABC', 'Nguyễn Văn An', '0901234567', 'nguyenvanan@abc.vn', '123 Đường Lê Lợi, Quận 1, TP Hồ Chí Minh', '0123456789', '5000000000'],
  ['Công ty Cổ phần Thương mại XYZ', 'Trần Thị Bình', '0912345678', 'tranthib@xyz.vn', '456 Phố Hoàn Kiếm, Hà Nội', '0987654321', '3000000000'],
  ['Công ty TNHH Nhựa Việt Nam', 'Lê Văn Cường', '0923456789', 'levanc@plastic.vn', '789 Đường Nguyễn Huệ, Đà Nẵng', '0111222333', '4000000000'],
  ['Công ty CP Hóa dầu Hải Phòng', 'Phạm Thị Dung', '0934567890', 'phamthid@petro.vn', '321 Đường Điện Biên Phủ, Hải Phòng', '0444555666', '6000000000'],
  ['Công ty TNHH Vật liệu Xây dựng', 'Hoàng Văn Em', '0945678901', 'hoangvane@material.vn', '654 Đường Trần Hưng Đạo, Cần Thơ', '0777888999', '2500000000']
];

// 中越混合订单数据
export const chinaVietnamOrderData = [
  ['客户名称', 'Sản phẩm', 'Số lượng', 'Đơn vị', '单价', 'Thành tiền', 'Tiền tệ', 'Điều kiện giao hàng'],
  ['Công ty ABC', 'Polyethylene (PE)', '100', 'Tấn', '8500', '850000', 'CNY', 'FOB'],
  ['上海化工', 'Polypropylene (PP)', '50', 'Tấn', '9000', '450000', 'CNY', 'CIF'],
  ['Công ty XYZ', 'Polyvinyl Chloride (PVC)', '80', 'Tấn', '7200', '576000', 'CNY', 'FOB'],
  ['北京贸易', 'PET树脂', '120', 'Tấn', '10500', '1260000', 'CNY', 'CIF'],
  ['Công ty Nhựa VN', 'Polystyrene (PS)', '60', 'Tấn', '8800', '528000', 'CNY', 'EXW']
];

// 完整出口订单（含海关信息）
export const exportOrderData = [
  ['客户名称', '产品名称', 'HS编码', '数量', '单位', '单价', '金额', '币种', '贸易术语', '起运港', '目的港', '集装箱号'],
  ['Công ty ABC', '聚乙烯树脂', '39011010', '100', '吨', '8500', '850000', 'CNY', 'FOB', '上海港', 'Cảng Hải Phòng', 'TCLU1234567'],
  ['Công ty XYZ', '聚丙烯树脂', '39021010', '50', '吨', '9000', '450000', 'CNY', 'CIF', '宁波港', 'Cảng Đà Nẵng', 'MSCU2345678'],
  ['Công ty Nhựa', 'PVC树脂', '39041010', '80', '吨', '7200', '576000', 'CNY', 'FOB', '深圳港', 'Cảng TP HCM', 'CMAU3456789'],
  ['Công ty Hóa chất', 'PET树脂', '39076110', '120', '吨', '10500', '1260000', 'CNY', 'CIF', '广州港', 'Cảng Hải Phòng', 'OOLU4567890'],
  ['Công ty Vật liệu', 'PS树脂', '39031110', '60', '吨', '8800', '528000', 'CNY', 'EXW', '厦门港', 'Cảng Đà Nẵng', 'APLU5678901']
];

// 越南语样品申请
export const vietnameseSampleData = [
  ['Tên khách hàng', 'Tên mẫu', 'Quy cách', 'Số lượng', 'Trọng lượng', 'Địa chỉ giao hàng', 'Người nhận', 'Điện thoại'],
  ['Công ty ABC', 'Mẫu Polyethylene', 'HD-5000', '2', '5kg', '123 Đường Lê Lợi, TP Hồ Chí Minh', 'Nguyễn Văn An', '0901234567'],
  ['Công ty XYZ', 'Mẫu Polypropylene', 'PP-3000', '1', '3kg', '456 Phố Hoàn Kiếm, Hà Nội', 'Trần Thị Bình', '0912345678'],
  ['Công ty Nhựa', 'Mẫu PVC', 'PVC-7000', '3', '8kg', '789 Đường Nguyễn Huệ, Đà Nẵng', 'Lê Văn Cường', '0923456789'],
  ['Công ty Hóa dầu', 'Mẫu PET', 'PET-8000', '2', '6kg', '321 Đường Điện Biên Phủ, Hải Phòng', 'Phạm Thị Dung', '0934567890'],
  ['Công ty Vật liệu', 'Mẫu PS', 'PS-4000', '1', '4kg', '654 Đường Trần Hưng Đạo, Cần Thơ', 'Hoàng Văn Em', '0945678901']
];

// 越南语物流信息
export const vietnameseShipmentData = [
  ['Mã vận đơn', 'Tên khách hàng', 'Số đơn hàng', 'Đơn vị vận chuyển', 'Ngày gửi', 'Ngày giao dự kiến', 'Trạng thái'],
  ['VN1234567890', 'Công ty ABC', 'SO-2026-001', 'Viettel Post', '10/02/2026', '12/02/2026', 'Đang vận chuyển'],
  ['VN2345678901', 'Công ty XYZ', 'SO-2026-002', 'Vietnam Post', '11/02/2026', '14/02/2026', 'Đã gửi'],
  ['VN3456789012', 'Công ty Nhựa', 'SO-2026-003', 'Giao Hàng Nhanh', '09/02/2026', '13/02/2026', 'Đã ký nhận'],
  ['VN4567890123', 'Công ty Hóa dầu', 'SO-2026-004', 'J&T Express', '12/02/2026', '15/02/2026', 'Đang giao'],
  ['VN5678901234', 'Công ty Vật liệu', 'SO-2026-005', 'Best Express', '08/02/2026', '16/02/2026', 'Đang vận chuyển']
];

// 多货币订单数据
export const multiCurrencyOrderData = [
  ['客户名称', '产品', '数量', '单位', '单价', '金额', '币种', '人民币金额'],
  ['Công ty ABC', '聚乙烯', '100', '吨', '8500', '850000', 'CNY', '850000'],
  ['Vietnam Plastic', 'Polypropylene', '50', 'Ton', '1200', '60000', 'USD', '432000'],
  ['Công ty XYZ', 'PVC', '80', 'Tấn', '25200000', '2016000000', 'VND', '576000'],
  ['上海化工', 'PET树脂', '120', '吨', '10500', '1260000', 'CNY', '1260000'],
  ['Hanoi Trading', 'PS', '60', 'Ton', '1100', '66000', 'USD', '475200']
];

/**
 * 将数据转换为CSV格式（支持越南语）
 */
export const convertToCSVWithVietnamese = (data: string[][]): string => {
  return data.map(row => 
    row.map(cell => {
      // 如果包含逗号、引号、换行或越南语特殊字符，需要用引号包裹
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
};

/**
 * 下载CSV文件（UTF-8 BOM编码，确保Excel正确显示越南语）
 */
export const downloadCSVWithVietnamese = (data: string[][], filename: string) => {
  const csv = convertToCSVWithVietnamese(data);
  // 添加UTF-8 BOM以确保Excel正确识别
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
 * 生成所有中越贸易示例文件
 */
export const generateChinaVietnamSamples = () => {
  downloadCSVWithVietnamese(vietnameseCustomerData, '越南语客户信息示例.csv');
  downloadCSVWithVietnamese(chinaVietnamOrderData, '中越混合订单示例.csv');
  downloadCSVWithVietnamese(exportOrderData, '完整出口订单示例.csv');
  downloadCSVWithVietnamese(vietnameseSampleData, '越南语样品申请示例.csv');
  downloadCSVWithVietnamese(vietnameseShipmentData, '越南语物流信息示例.csv');
  downloadCSVWithVietnamese(multiCurrencyOrderData, '多货币订单示例.csv');
};

export default {
  vietnameseCustomerData,
  chinaVietnamOrderData,
  exportOrderData,
  vietnameseSampleData,
  vietnameseShipmentData,
  multiCurrencyOrderData,
  convertToCSVWithVietnamese,
  downloadCSVWithVietnamese,
  generateChinaVietnamSamples
};
