import React, { useState } from 'react';
import { parseTableFile, recognizeAndParseTable, ParsedFormData } from '../services/freeAIService';

interface TableImportProps {
  onDataConfirmed: (data: any[], type: string) => void;
  onCancel: () => void;
}

export const TableImport: React.FC<TableImportProps> = ({ onDataConfirmed, onCancel }) => {
  const [parsedData, setParsedData] = useState<ParsedFormData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [step, setStep] = useState<'upload' | 'preview' | 'confirm'>('upload');

  // 处理文件上传
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setError('');
    setLoading(true);

    try {
      // 解析表格文件
      const table = await parseTableFile(selectedFile);

      // 识别并解析数据
      const parsed = recognizeAndParseTable(table);
      setParsedData(parsed);

      setStep('preview');
    } catch (err: any) {
      setError(err.message || '文件解析失败');
    } finally {
      setLoading(false);
    }
  };

  // 确认导入
  const handleConfirm = () => {
    if (parsedData && parsedData.data.length > 0) {
      onDataConfirmed(parsedData.data, parsedData.type);
    }
  };

  // 重新上传
  const handleReupload = () => {
    setParsedData(null);
    setStep('upload');
    setError('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* 标题栏 */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">📊 智能表格导入</h2>
            <p className="text-sm text-blue-100 mt-1">上传Excel或CSV文件，自动识别并批量导入数据</p>
          </div>
          <button
            onClick={onCancel}
            className="text-white hover:bg-blue-800 rounded-full p-2 transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {/* 步骤1: 上传文件 */}
          {step === 'upload' && (
            <div className="text-center py-12">
              <div className="mb-6">
                <svg className="w-24 h-24 mx-auto text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>

              <h3 className="text-2xl font-bold text-gray-800 mb-2">上传表格文件</h3>
              <p className="text-gray-600 mb-8">支持 .xlsx, .xls, .csv 格式</p>

              <label className="inline-block cursor-pointer">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={loading}
                />
                <div className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-semibold transition inline-flex items-center">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      解析中...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      选择文件
                    </>
                  )}
                </div>
              </label>

              {error && (
                <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                  <p className="font-semibold">❌ 错误</p>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              )}

              <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-2xl mb-2">👥</div>
                  <div className="font-semibold text-gray-800">客户信息</div>
                  <div className="text-sm text-gray-600 mt-1">批量导入客户资料</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-2xl mb-2">📦</div>
                  <div className="font-semibold text-gray-800">销售订单</div>
                  <div className="text-sm text-gray-600 mt-1">快速录入订单数据</div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <div className="text-2xl mb-2">🧪</div>
                  <div className="font-semibold text-gray-800">样品申请</div>
                  <div className="text-sm text-gray-600 mt-1">批量处理样品请求</div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <div className="text-2xl mb-2">🚚</div>
                  <div className="font-semibold text-gray-800">物流信息</div>
                  <div className="text-sm text-gray-600 mt-1">导入运单追踪</div>
                </div>
              </div>
            </div>
          )}

          {/* 步骤2: 预览和确认 */}
          {step === 'preview' && parsedData && (
            <div>
              {/* 识别结果 */}
              <div className="mb-6 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center mb-3">
                      <span className="text-3xl mr-3">
                        {parsedData.type === 'customer' && '👥'}
                        {parsedData.type === 'order' && '📦'}
                        {parsedData.type === 'sample' && '🧪'}
                        {parsedData.type === 'shipment' && '🚚'}
                        {parsedData.type === 'unknown' && '📄'}
                      </span>
                      <div>
                        <h3 className="text-xl font-bold text-gray-800">
                          识别类型: {getTypeName(parsedData.type)}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          置信度: {(parsedData.confidence * 100).toFixed(0)}% | 
                          共识别 {parsedData.data.length} 条记录
                        </p>
                      </div>
                    </div>

                    {/* 建议 */}
                    {parsedData.suggestions.length > 0 && (
                      <div className="bg-white rounded-lg p-4 mb-3">
                        <p className="font-semibold text-gray-700 mb-2">💡 智能建议：</p>
                        <ul className="space-y-1">
                          {parsedData.suggestions.map((suggestion, index) => (
                            <li key={index} className="text-sm text-gray-600 flex items-start">
                              <span className="text-blue-500 mr-2">•</span>
                              {suggestion}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 警告 */}
                    {parsedData.warnings.length > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <p className="font-semibold text-yellow-800 mb-2">⚠️ 需要注意：</p>
                        <ul className="space-y-1">
                          {parsedData.warnings.slice(0, 5).map((warning, index) => (
                            <li key={index} className="text-sm text-yellow-700 flex items-start">
                              <span className="text-yellow-500 mr-2">•</span>
                              {warning}
                            </li>
                          ))}
                          {parsedData.warnings.length > 5 && (
                            <li className="text-sm text-yellow-600 italic">
                              ...还有 {parsedData.warnings.length - 5} 条警告
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleReupload}
                    className="ml-4 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm"
                  >
                    重新上传
                  </button>
                </div>
              </div>

              {/* 数据预览表格 */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
                  <h4 className="font-semibold text-gray-800">数据预览（前10条）</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">序号</th>
                        {Object.keys(parsedData.data[0] || {}).map((key) => (
                          <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {parsedData.data.slice(0, 10).map((row, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-600">{index + 1}</td>
                          {Object.values(row).map((value: any, cellIndex) => (
                            <td key={cellIndex} className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value || '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsedData.data.length > 10 && (
                  <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-sm text-gray-600 text-center">
                    还有 {parsedData.data.length - 10} 条数据未显示
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        {step === 'preview' && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition font-semibold"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              确认导入 ({parsedData?.data.length || 0} 条)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// 辅助函数：获取类型名称
const getTypeName = (type: string): string => {
  const typeNames: Record<string, string> = {
    customer: '客户信息',
    order: '销售订单',
    sample: '样品申请',
    shipment: '物流信息',
    unknown: '未知类型'
  };
  return typeNames[type] || '未知';
};

export default TableImport;
