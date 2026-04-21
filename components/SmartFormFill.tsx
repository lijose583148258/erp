import React, { useCallback, useMemo, useState } from 'react';
import { Mic, Sparkles, Check, X, Loader2, AlertCircle, Edit3 } from 'lucide-react';
import VoiceInput from './VoiceInput';
import { smartFormFill, ExtractedFormData, matchCustomer } from '../services/smartFormService';
import { useAppContext } from '../app/AppContext';

interface SmartFormFillProps {
    onFill: (data: ExtractedFormData) => void;
    customers?: Array<{ id: string; name: string; nameZh?: string; nameEn?: string; nameVi?: string; displayName?: string }>;
    compact?: boolean;
    className?: string;
}

const SmartFormFill: React.FC<SmartFormFillProps> = ({
    onFill,
    customers = [],
    compact = false,
    className = '',
}) => {
    const { t } = useAppContext();

    const [isOpen, setIsOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [extractedData, setExtractedData] = useState<ExtractedFormData | null>(null);
    const [manualInput, setManualInput] = useState('');
    const [showManualInput, setShowManualInput] = useState(false);

    const handleVoiceResult = useCallback(async (text: string) => {
        setIsProcessing(true);
        setManualInput(text);
        try {
            const result = await smartFormFill(text, true);
            if (result.success && result.data) {
                const nextData = { ...result.data } as ExtractedFormData & { customerId?: string };
                if (nextData.customerName && customers.length > 0) {
                    const matched = matchCustomer(nextData.customerName, customers);
                    if (matched) {
                        nextData.customerName = matched.name;
                        nextData.customerId = matched.id;
                    }
                }
                setExtractedData(nextData);
            } else {
                throw new Error(result.message || '解析失败');
            }
        } catch (error: any) {
            console.error(error);
        } finally {
            setIsProcessing(false);
        }
    }, [customers]);

    const handleManualSubmit = useCallback(() => {
        if (manualInput.trim()) {
            handleVoiceResult(manualInput.trim());
            setShowManualInput(false);
        }
    }, [handleVoiceResult, manualInput]);

    const handleConfirm = useCallback(() => {
        if (extractedData) {
            onFill(extractedData);
            setExtractedData(null);
            setManualInput('');
            setShowManualInput(false);
            setIsOpen(false);
        }
    }, [extractedData, onFill]);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        setExtractedData(null);
        setManualInput('');
        setShowManualInput(false);
        setIsProcessing(false);
    }, []);

    if (compact) {
        return (
            <>
                <button
                    onClick={() => setIsOpen(true)}
                    className={`flex items-center px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-bold text-xs shadow-lg hover:shadow-xl active:scale-95 transition-all ${className}`}
                >
                    <Mic size={16} className="mr-2" />
                    {t.smartFill}
                </button>
                {isOpen && (
                    <SmartFormFillModal
                        onClose={handleClose}
                        onVoiceResult={handleVoiceResult}
                        onConfirm={handleConfirm}
                        onManualSubmit={handleManualSubmit}
                        extractedData={extractedData}
                        isProcessing={isProcessing}
                        manualInput={manualInput}
                        setManualInput={setManualInput}
                        showManualInput={showManualInput}
                        setShowManualInput={setShowManualInput}
                        t={t}
                    />
                )}
            </>
        );
    }

    return (
        <div className={`bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 rounded-[32px] border border-blue-100 dark:border-blue-800/30 p-6 ${className}`}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                    <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl text-white mr-3">
                        <Sparkles size={20} />
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800 dark:text-white">{t.smartFill}</h3>
                        <p className="text-[10px] text-slate-400 font-bold">{t.voiceTip}</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowManualInput((prev) => !prev)}
                    className="p-2 bg-white dark:bg-slate-800 rounded-xl text-slate-400 hover:text-blue-600 transition-all"
                >
                    <Edit3 size={18} />
                </button>
            </div>

            {showManualInput ? (
                <div className="space-y-3">
                    <textarea
                        value={manualInput}
                        onChange={(e) => setManualInput(e.target.value)}
                        placeholder="输入或粘贴文本，例如：给上海化工下单，聚乙烯50吨，8500一吨，30天账期。"
                        className="w-full h-24 bg-white dark:bg-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowManualInput(false)}
                            className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-500"
                        >
                            {t.cancel}
                        </button>
                        <button
                            onClick={handleManualSubmit}
                            disabled={!manualInput.trim() || isProcessing}
                            className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center"
                        >
                            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                            {t.smartFill}
                        </button>
                    </div>
                </div>
            ) : (
                <VoiceInput
                    onResult={handleVoiceResult}
                    onCancel={handleClose}
                    placeholder={t.voicePlaceholder}
                    compact={false}
                />
            )}

            {extractedData && !showManualInput && (
                <ExtractedDataPreview
                    data={extractedData}
                    onConfirm={handleConfirm}
                    onCancel={() => setExtractedData(null)}
                    t={t}
                />
            )}
        </div>
    );
};

const SmartFormFillModal: React.FC<{
    onClose: () => void;
    onVoiceResult: (text: string) => void;
    onConfirm: () => void;
    onManualSubmit: () => void;
    extractedData: ExtractedFormData | null;
    isProcessing: boolean;
    manualInput: string;
    setManualInput: (v: string) => void;
    showManualInput: boolean;
    setShowManualInput: (v: boolean) => void;
    t: any;
}> = ({
    onClose,
    onVoiceResult,
    onConfirm,
    onManualSubmit,
    extractedData,
    isProcessing,
    manualInput,
    setManualInput,
    showManualInput,
    setShowManualInput,
    t,
}) => (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white dark:bg-slate-900 w-full sm:max-w-lg sm:mx-4 rounded-t-[32px] sm:rounded-[32px] shadow-2xl animate-in slide-in-from-bottom sm:zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900">
                <div className="flex items-center">
                    <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl text-white mr-3">
                        <Sparkles size={20} />
                    </div>
                    <h2 className="font-black text-lg text-slate-900 dark:text-white">{t.smartFill}</h2>
                </div>
                <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full">
                    <X size={20} />
                </button>
            </div>
            <div className="p-6">
                {!showManualInput ? (
                    <>
                        <VoiceInput
                            onResult={onVoiceResult}
                            onCancel={onClose}
                            placeholder={t.voicePlaceholder}
                        />
                        <button
                            onClick={() => setShowManualInput(true)}
                            className="w-full mt-4 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm font-bold text-slate-500 flex items-center justify-center"
                        >
                            <Edit3 size={16} className="mr-2" />
                            手动输入文字
                        </button>
                    </>
                ) : (
                    <div className="space-y-4">
                        <textarea
                            value={manualInput}
                            onChange={(e) => setManualInput(e.target.value)}
                            placeholder="输入订单信息，例如：给上海化工下单，聚乙烯50吨，8500一吨，30天账期。"
                            className="w-full h-32 bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                            autoFocus
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowManualInput(false)}
                                className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-500"
                            >
                                <Mic size={16} className="inline mr-2" />
                                语音输入
                            </button>
                            <button
                                onClick={onManualSubmit}
                                disabled={!manualInput.trim() || isProcessing}
                                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center"
                            >
                                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} className="mr-2" />}
                                智能解析
                            </button>
                        </div>
                    </div>
                )}

                {extractedData && (
                    <ExtractedDataPreview
                        data={extractedData}
                        onConfirm={onConfirm}
                        onCancel={() => {}}
                        t={t}
                    />
                )}
            </div>
        </div>
    </div>
);

const ExtractedDataPreview: React.FC<{
    data: ExtractedFormData;
    onConfirm: () => void;
    onCancel: () => void;
    t: any;
}> = ({ data, onConfirm, onCancel, t }) => {
    const fields = useMemo(() => [
        { key: 'customerName', label: '客户', icon: '🏢' },
        { key: 'contactName', label: '联系人', icon: '👤' },
        { key: 'productName', label: '产品', icon: '📦' },
        { key: 'quantity', label: '数量', icon: '🔢', suffix: data.unit || '' },
        { key: 'unitPrice', label: '单价', icon: '💰', prefix: '¥' },
        { key: 'paymentTerms', label: '账期', icon: '📅', suffix: '天' },
        { key: 'address', label: '地址', icon: '📍' },
    ], [data.unit]);

    const filledFields = fields.filter((field) => (data as any)[field.key]);

    return (
        <div className="mt-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800">
            <div className="flex items-center mb-3">
                <Check size={18} className="text-emerald-600 mr-2" />
                <span className="font-bold text-sm text-emerald-700 dark:text-emerald-400">
                    已识别 {filledFields.length} 项信息
                </span>
                <span className="ml-auto text-[10px] font-bold text-emerald-500 bg-emerald-100 dark:bg-emerald-800 px-2 py-0.5 rounded-lg">
                    {Math.round((data.confidence || 0) * 100)}% 置信度
                </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
                {filledFields.map((field) => (
                    <div key={field.key} className="bg-white dark:bg-slate-800 rounded-xl p-2 flex items-center">
                        <span className="mr-2">{field.icon}</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-slate-400 font-bold">{field.label}</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white truncate">
                                {field.prefix}{(data as any)[field.key]}{field.suffix}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            {data.suggestions && data.suggestions.length > 0 && (
                <div className="mb-4 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-start text-xs text-amber-700">
                    <AlertCircle size={14} className="mr-2 shrink-0 mt-0.5" />
                    <span>{data.suggestions.join('；')}</span>
                </div>
            )}

            <div className="flex gap-2">
                <button
                    onClick={onCancel}
                    className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-500"
                >
                    取消
                </button>
                <button
                    onClick={onConfirm}
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-emerald-700 active:scale-95 transition-all flex items-center justify-center"
                >
                    <Check size={18} className="mr-2" />
                    {t.confirmFill}
                </button>
            </div>
        </div>
    );
};

export default SmartFormFill;
