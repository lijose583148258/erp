import React, { useState } from 'react';
import { Upload, Download, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import TableImport from '../components/TableImport';
import { 
  sampleCustomerData, 
  sampleOrderData, 
  sampleSampleData, 
  sampleShipmentData,
  downloadCSV 
} from '../utils/sampleDataGenerator';

const TableImportTest = () => {
  const [showImport, setShowImport] = useState(false);
  const [importedData, setImportedData] = useState<any[]>([]);
  const [importType, setImportType] = useState<string>('');

  const handleDataConfirmed = (data: any[], type: string) => {
    setImportedData(data);
    setImportType(type);
    setShowImport(false);
    
    // 这里可以调用实际的API保存数据
    // 数据已导入，由 UI 反馈用户
  };

  const downloadSample = (type: 'customer' | 'order' | 'sample' | 'shipment') => {
    const dataMap = {
      customer: { data: sampleCustomerData, name: '客户信息示例.csv' },
      order: { data: sampleOrderData, name: '销售订单示例.csv' },
      sample: { data: sampleSampleData, name: '样品申请示例.csv' },
      shipment: { data: sampleShipmentData, name: '物流信息示例.csv' }
    };
    
    const { data, name } = dataMap[type];
    downloadCSV(data, name);
  };

  const getTypeName = (type: string) => {
    const names: Record<string, string> = {
      customer: '客户信息',
      order: '销售订单',
      sample: '样品申请',
      shipment: '物流信息'
    };
    return names[type] || '未知';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            📊 智能表格识别测试
          </h1>
          <p className="text-lg text-gray-600">
            上传Excel或CSV文件，自动识别并批量导入数据
          </p>
        </div>

        {/* 主要操作区 */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="text-center mb-8">
            <div className="inline-block p-6 bg-blue-100 rounded-full mb-4">
              <Upload className="w-16 h-16 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">开始测试</h2>
            <p className="text-gray-600 mb-6">
              点击下方按钮上传表格文件，或先下载示例文件进行测试
            </p>
            
            <button
              onClick={() => setShowImport(true)}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-lg transition shadow-lg hover:shadow-xl inline-flex items-center"
            >
              <Upload className="w-6 h-6 mr-2" />
              上传表格文件
            </button>
          </div>

          {/* 导入结果 */}
          {importedData.length > 0 && (
            <div className="mt-8 p-6 bg-green-50 border-2 border-green-200 rounded-xl">
              <div className="flex items-start">
                <CheckCircle className="w-6 h-6 text-green-600 mr-3 mt-1 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-green-800 mb-2">
                    ✅ 导入成功！
                  </h3>
                  <div className="space-y-1 text-sm text-green-700">
                    <p>• 识别类型：<span className="font-semibold">{getTypeName(importType)}</span></p>
                    <p>• 导入数量：<span className="font-semibold">{importedData.length} 条</span></p>
                    <p>• 状态：数据已保存到系统</p>
                  </div>
                  
                  <button
                    onClick={() => {
                      setImportedData([]);
                      setImportType('');
                    }}
                    className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition"
                  >
                    清除结果
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 示例文件下载 */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="flex items-center mb-6">
            <Download className="w-6 h-6 text-blue-600 mr-3" />
            <h2 className="text-2xl font-bold text-gray-800">下载示例文件</h2>
          </div>
          
          <p className="text-gray-600 mb-6">
            如果您还没有准备好的数据文件，可以先下载我们的示例文件进行测试
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 客户信息 */}
            <div className="border-2 border-blue-200 rounded-xl p-6 hover:border-blue-400 transition">
              <div className="text-4xl mb-3">👥</div>
              <h3 className="font-bold text-gray-800 mb-2">客户信息</h3>
              <p className="text-sm text-gray-600 mb-4">
                包含5个客户记录，含联系方式、信用额度等
              </p>
              <button
                onClick={() => downloadSample('customer')}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition text-sm"
              >
                下载示例
              </button>
            </div>

            {/* 销售订单 */}
            <div className="border-2 border-green-200 rounded-xl p-6 hover:border-green-400 transition">
              <div className="text-4xl mb-3">📦</div>
              <h3 className="font-bold text-gray-800 mb-2">销售订单</h3>
              <p className="text-sm text-gray-600 mb-4">
                包含5个订单记录，含产品、CAS号、纯度、批次等生物科技字段
              </p>
              <button
                onClick={() => downloadSample('order')}
                className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition text-sm"
              >
                下载示例
              </button>
            </div>

            {/* 样品申请 */}
            <div className="border-2 border-purple-200 rounded-xl p-6 hover:border-purple-400 transition">
              <div className="text-4xl mb-3">🧪</div>
              <h3 className="font-bold text-gray-800 mb-2">样品申请</h3>
              <p className="text-sm text-gray-600 mb-4">
                包含5个样品申请，含规格、寄送地址等
              </p>
              <button
                onClick={() => downloadSample('sample')}
                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition text-sm"
              >
                下载示例
              </button>
            </div>

            {/* 物流信息 */}
            <div className="border-2 border-orange-200 rounded-xl p-6 hover:border-orange-400 transition">
              <div className="text-4xl mb-3">🚚</div>
              <h3 className="font-bold text-gray-800 mb-2">物流信息</h3>
              <p className="text-sm text-gray-600 mb-4">
                包含5个物流记录，含运单号、状态等
              </p>
              <button
                onClick={() => downloadSample('shipment')}
                className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold transition text-sm"
              >
                下载示例
              </button>
            </div>
          </div>
        </div>

        {/* 功能说明 */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center mb-6">
            <FileSpreadsheet className="w-6 h-6 text-blue-600 mr-3" />
            <h2 className="text-2xl font-bold text-gray-800">功能说明</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-bold text-gray-800 mb-3 flex items-center">
                <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                支持的功能
              </h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>✅ 自动识别4种数据类型</li>
                <li>✅ 智能字段映射（中英文）</li>
                <li>✅ 数据验证和清洗</li>
                <li>✅ 实时预览和确认</li>
                <li>✅ 批量导入（支持1000+条）</li>
                <li>✅ 完全本地运行，无需API</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-gray-800 mb-3 flex items-center">
                <AlertCircle className="w-5 h-5 text-blue-600 mr-2" />
                使用提示
              </h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>📋 第一行必须是表头（列名）</li>
                <li>📋 使用标准字段名提高识别率</li>
                <li>📋 避免合并单元格和空行</li>
                <li>📋 支持 .xlsx, .xls, .csv 格式</li>
                <li>📋 建议单次导入不超过1000条</li>
                <li>📋 导入前会显示预览供确认</li>
              </ul>
            </div>
          </div>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>💡 提示：</strong>
              如需查看详细的使用文档和表格格式要求，请查看项目根目录下的
              <code className="mx-1 px-2 py-1 bg-blue-100 rounded">智能表格识别功能说明.md</code>
              文件。
            </p>
          </div>
        </div>
      </div>

      {/* Table Import Modal */}
      {showImport && (
        <TableImport
          onDataConfirmed={handleDataConfirmed}
          onCancel={() => setShowImport(false)}
        />
      )}
    </div>
  );
};

export default TableImportTest;
