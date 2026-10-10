import React from 'react';
import { Box, Camera, CheckCircle, Image as ImageIcon, Plus, X } from 'lucide-react';
import { MaterialMasterCombobox } from '../../components/materials/MaterialMasterCombobox';
import type { MaterialMaster } from '../../services/material.service';

type Props = {
  t: Record<string, string>;
  ocrText: string;
  setOcrText: React.Dispatch<React.SetStateAction<string>>;
  ocrImage: string | null;
  ocrImages: string[];
  selectedImageIndex: number;
  previewMode: 'single' | 'gallery';
  isOcrProcessing: boolean;
  ocrResult: any;
  ocrMaterialQuery: string;
  ocrMaterial: MaterialMaster | null;
  onMaterialQueryChange: (value: string) => void;
  onMaterialClear: () => void;
  onMaterialSelect: (material: MaterialMaster) => void;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onParse: () => void;
  onApply: () => void;
  onRemoveImage: (index: number) => void;
  onSelectImage: (index: number) => void;
  onClearAll: () => void;
  onTogglePreview: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
};

const ShippingOcrPanel: React.FC<Props> = ({
  t,
  ocrText,
  setOcrText,
  ocrImage,
  ocrImages,
  selectedImageIndex,
  previewMode,
  isOcrProcessing,
  ocrResult,
  ocrMaterialQuery,
  ocrMaterial,
  onMaterialQueryChange,
  onMaterialClear,
  onMaterialSelect,
  onImageUpload,
  onParse,
  onApply,
  onRemoveImage,
  onSelectImage,
  onClearAll,
  onTogglePreview,
  fileInputRef,
}) => {
 const uploadCardClass = `relative h-48 rounded-2xl border-2 border-dashed transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none flex flex-col items-center justify-center cursor-pointer overflow-hidden ${
    ocrImage
      ? 'border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20'
      : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/30 hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-800'
  }`;

 const parseButtonClass = `flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none flex items-center justify-center ${
    isOcrProcessing
      ? 'bg-slate-400 text-white cursor-not-allowed shadow-slate-200'
      : 'bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700'
  }`;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-widest flex items-center">
            <ImageIcon className="mr-2 text-blue-500" size={20} />
            {t.ocrCenter}
          </h2>
          <p className="text-xs text-slate-500 font-bold mt-1">{t.ocrShipmentHint}</p>
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs font-black uppercase tracking-widest border border-blue-100 dark:border-blue-800">
            AI Powered
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div data-testid="shipping-ocr-upload-card" onClick={() => fileInputRef.current?.click()} className={uploadCardClass}>
            <input data-testid="shipping-ocr-upload-input" type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={onImageUpload} />
            {ocrImage ? (
              <>
                <img src={ocrImage} alt="OCR Preview" className="absolute inset-0 w-full h-full object-contain opacity-40 blur-[1px]" />
                <div className="relative z-10 flex flex-col items-center">
                  <CheckCircle size={32} className="text-blue-500 mb-2" />
                  <p className="text-xs font-black text-blue-600">
                    {t.imageLoaded || '图片已加载'}
                    {ocrImages.length > 1 ? ` (${ocrImages.length})` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearAll();
                    }}
                    className="mt-2 text-xs font-black text-rose-500 hover:underline"
                  >
                    {t.clear || '清空'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Camera size={32} className="text-slate-300 mb-3" />
                <p className="text-xs font-black text-slate-500 text-center px-6 leading-relaxed">{t.aiOcrDragDrop}</p>
              </>
            )}
          </div>

          {ocrImages.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                {ocrImages.length} {t.images || 'Images'}
              </span>
              <div className="flex items-center gap-2">
                {ocrImages.length > 1 && (
                  <button
                    type="button"
                    onClick={onTogglePreview}
                    className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {previewMode === 'single' ? (t.gallery || '画廊') : (t.single || '单张')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClearAll}
                  className="px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                >
                  {t.clear || '清空'}
                </button>
              </div>
            </div>
          )}

          {previewMode === 'gallery' && ocrImages.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {ocrImages.map((img, idx) => {
                const selected = idx === selectedImageIndex;
                return (
                  <div
                    key={idx}
                    onClick={() => onSelectImage(idx)}
                    className={`relative w-20 h-20 rounded-2xl overflow-hidden border-2 flex-shrink-0 cursor-pointer ${
                      selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <img src={img} alt={`OCR ${idx + 1}`} className="w-full h-full object-cover" />
                    <span
                      className={`absolute left-2 top-2 px-2 py-0.5 rounded-full text-[11px] font-black ${
                        selected ? 'bg-blue-600 text-white' : 'bg-white/90 text-slate-700'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveImage(idx);
                      }}
                      className="absolute right-2 top-2 p-1 rounded-full bg-white/90 hover:bg-white text-slate-700"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <textarea
            data-testid="shipping-ocr-textarea"
            value={ocrText}
            onChange={(e) => setOcrText(e.target.value)}
            placeholder={t.ocrPlaceholder}
 className="w-full h-24 bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 text-xs font-bold outline-none resize-none border border-transparent focus:border-blue-300 dark:focus:border-blue-900 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none"
          />

          <div className="flex items-center gap-3">
            <button data-testid="shipping-ocr-parse-button" onClick={onParse} disabled={isOcrProcessing} className={parseButtonClass}>
              {isOcrProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  {t.aiProcessing}
                </>
              ) : (
                <>
                  <Plus size={16} className="mr-2" />
                  {t.ocrParse}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/30 rounded-2xl p-6 border border-slate-100 dark:border-slate-800 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t.ocrResult || '识别预览'}</h3>
            {ocrResult && (
              <div className="flex items-center text-emerald-600 text-xs font-black uppercase">
                <CheckCircle size={12} className="mr-1" />
                {t.ocrConfidence}: {Math.round(ocrResult.confidence * 100)}%
              </div>
            )}
          </div>

          {ocrResult ? (
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1">{t.customerName}</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white truncate">{ocrResult.customerName || t.ocrNotFound}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1">{t.productName}</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white truncate">{ocrResult.productName || t.ocrNotFound}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1">{t.quantity}</p>
                  <p className="text-xs font-black text-slate-800 dark:text-white">{ocrResult.quantity} {ocrResult.unit}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1">{t.batchNo}</p>
                  <p className="text-xs font-black text-blue-600 truncate">
                    {ocrResult.batchNo || ocrResult.trackingNo || ocrResult.shipmentNo || 'PENDING'}
                  </p>
                </div>
                {ocrResult.casNo && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-800">
                    <p className="text-[11px] text-indigo-400 font-black uppercase mb-1">{t.casNo}</p>
                    <p className="text-xs font-black text-indigo-700 dark:text-indigo-300">{ocrResult.casNo}</p>
                  </div>
                )}
                {ocrResult.purity && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl border border-emerald-100 dark:border-emerald-800">
                    <p className="text-[11px] text-emerald-400 font-black uppercase mb-1">{t.purity}</p>
                    <p className="text-xs font-black text-emerald-700 dark:text-emerald-300">{ocrResult.purity}</p>
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <MaterialMasterCombobox
                  dataTestId="shipping-ocr-material-input"
                  label="过账物料确认"
                  value={ocrMaterialQuery}
                  selectedMaterialId={ocrMaterial?.id || null}
                  onTextChange={onMaterialQueryChange}
                  onClearSelection={onMaterialClear}
                  onSelect={onMaterialSelect}
                />
                <p className="mt-2 text-[11px] font-semibold leading-5 text-amber-800 dark:text-amber-200">
                  OCR 品名只作为检索提示，不会自动绑定物料。请人工核对物料编码、名称和基础单位后再创建发货单。
                </p>
              </div>
              <button
                data-testid="shipping-ocr-apply-button"
                onClick={onApply}
                disabled={!ocrMaterial}
 className="w-full py-3 bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-emerald-100 dark:shadow-none hover:bg-emerald-600 transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none motion-reduce:transition-none dark:disabled:bg-slate-700"
              >
                {ocrMaterial ? t.ocrApply : '请先确认统一物料'}
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-30">
              <Box size={40} className="text-slate-400 mb-4" />
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{t.awaitingOcr || '等待识别数据...'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShippingOcrPanel;
