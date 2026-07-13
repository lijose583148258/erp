import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DataTable, { Column } from '../components/DataTable';
import { Contract, Customer } from '../types';
import { FileText, Plus, Search, DollarSign, CheckCircle, Clock, FileUp, Zap, Link as LinkIcon, ShieldCheck } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { contractService } from '../services/contract.service';
import { customerService } from '../src/services/customer.service';
import { getCustomerDisplayName } from '../utils/customerName';

const Contracts = () => {
    const { t, notify, formatPrice, language } = useAppContext();
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // OCR States
    const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);
    const [isOcrProcessing, setIsOcrProcessing] = useState(false);
    const [ocrImage, setOcrImage] = useState<string | null>(null);
    const [ocrResult, setOcrResult] = useState<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [cRes, custs] = await Promise.all([
                contractService.getAll(),
                customerService.getAll()
            ]);
            setContracts(cRes.data || []);
            setCustomers(custs || []);
        } catch {
            notify('error', t.loadDataFail || '加载数据失败');
        } finally {
            setIsLoading(false);
        }
    }, [notify, t.loadDataFail]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => setOcrImage(reader.result as string);
        reader.readAsDataURL(file);

        setIsOcrProcessing(true);
        try {
            const result = await contractService.analyzeFile(file);
            setOcrResult(result);
            notify('success', t.ocrExtractSuccess || '条款提取成功');
        } catch {
            notify('error', t.ocrExtractFail || '提取失败');
        } finally {
            setIsOcrProcessing(false);
        }
    };

    const handleOcrCreate = async () => {
        if (!ocrResult) return;
        if (!String(ocrResult.title || '').trim()) {
            notify('warning', '请先确认合同标题');
            return;
        }
        try {
            await contractService.create({
                ...ocrResult,
                fileUrl: ocrImage,
                status: 'draft'
            });
            setIsOcrModalOpen(false);
            setOcrImage(null);
            setOcrResult(null);
            void loadData();
            notify('success', t.saveDraftSuccess || '合同已保存为草稿');
        } catch {
            notify('error', t.saveFail || '保存失败');
        }
    };

    const columns: Column<Contract>[] = [
        {
            header: t.contractNo || '合同编号',
            key: 'contractNo',
            accessor: (row) => (
                <div className="flex items-center gap-2">
                    <FileText size={14} className="text-slate-400" />
                    <span className="font-mono font-bold tracking-tighter">#{row.contractNo}</span>
                </div>
            )
        },
        {
            header: t.contractTitle || '标题',
            key: 'title',
            accessor: (row) => <span className="font-bold">{row.title}</span>
        },
        {
            header: t.customerName || '客户',
            key: 'customer',
            accessor: (row) => getCustomerDisplayName({
                name: row.customerName || '',
                nameZh: row.customerNameZh || undefined,
                nameEn: row.customerNameEn || undefined,
                nameVi: row.customerNameVi || undefined,
            }, language)
        },
        {
            header: t.contractAmount || '合同总计',
            key: 'totalAmount',
            accessor: (row) => (
                <span className="font-black text-blue-600">
                    {formatPrice(row.totalAmount, row.currency as any)}
                </span>
            )
        },
        {
            header: t.contractStatus || '状态',
            key: 'status',
            accessor: (row) => (
                <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${row.status === 'active' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                    row.status === 'draft' ? 'bg-slate-50 text-slate-600 border-slate-200' :
                        row.status === 'completed' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                            'bg-rose-50 text-rose-600 border-rose-100'
                    }`}>
                    {t[`contract${row.status.charAt(0).toUpperCase() + row.status.slice(1)}`] || row.status}
                </span>
            )
        },
        {
            header: t.linkedOrders || '关联订单',
            key: 'orders',
            accessor: (row) => (
                <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-100">
                    <LinkIcon size={12} className="text-slate-400" />
                    <span className="text-[10px] font-bold">{row.linkedOrdersCount || 0}</span>
                </div>
            )
        },
        {
            header: t.fulfillmentProgress || '履约进度',
            key: 'progress',
            accessor: (row) => {
                const totalAmount = Number(row.totalAmount || 0);
                const linkedAmount = Number(row.totalLinkedAmount || 0);
                const percent = totalAmount > 0 ? Math.min(Math.round((linkedAmount / totalAmount) * 100), 100) : 0;
                return (
                    <div className="w-32">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[11px] font-black text-slate-400 tracking-tighter">{formatPrice(linkedAmount, row.currency as any)}</span>
                            <span className="text-[11px] font-black text-blue-600">{percent}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ${percent > 90 ? 'bg-rose-500' : percent > 50 ? 'bg-amber-500' : 'bg-blue-500'}`}
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                    </div>
                );
            }
        },
        {
            header: t.signedAt || '签署日期',
            key: 'signedAt',
            accessor: (row) => row.signedAt ? new Date(row.signedAt).toLocaleDateString() : '-'
        }
    ];

    const stats = useMemo(() => {
        const active = contracts.filter(c => c.status === 'active').length;
        const totalVal = contracts.reduce((acc, c) => acc + Number(c.totalAmount || 0), 0);
        const nearExpiry = contracts.filter(c => {
            if (!c.expiredAt) return false;
            const diff = new Date(c.expiredAt).getTime() - new Date().getTime();
            return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
        }).length;

        return { active, totalVal, nearExpiry };
    }, [contracts]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">
                        {t.contractsTitle || '合同管理中心'}
                    </h1>
                    <p className="text-slate-500 font-medium tracking-tight text-sm mt-2">
                        Digital Contract Lifecycle Management with AI OCR
                    </p>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                    <button
                        data-testid="contracts-open-ocr"
                        onClick={() => setIsOcrModalOpen(true)}
                        className="flex items-center px-6 py-3 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-100 transition-all"
                    >
                        <Zap size={16} className="mr-2" />
                        AI 快速录入
                    </button>
                    <p className="max-w-xs text-right text-[11px] font-bold leading-5 text-slate-400">
                        手动合同草稿会并入统一合同表单；当前页面只保留可闭环的 OCR 草稿入口和订单关联回读。
                    </p>
                </div>
            </div>

            <section data-testid="contracts-boundary-notice" className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 text-sm font-bold leading-6 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
                    <div className="mb-2 flex items-center gap-2 text-xs font-black tracking-[0.16em] text-slate-500 dark:text-slate-300">
                        <ShieldCheck size={14} />
                        合同主数据入口
                    </div>
                    本页只管理合同档案、OCR 提取、签署状态和订单关联，不直接创建销售订单、采购入库或财务收款。
                </div>
                <div className="rounded-[28px] border border-blue-100 bg-blue-50/80 p-5 text-sm font-bold leading-6 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
                    <div className="mb-2 text-xs font-black tracking-[0.16em] text-blue-600 dark:text-blue-200">履约边界</div>
                    合同金额是约束口径；真实发货、回款、采购收货和库存变化必须在对应业务模块形成凭证后再回写进度。
                </div>
                <div className="rounded-[28px] border border-indigo-100 bg-indigo-50/80 p-5 text-sm font-bold leading-6 text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-100">
                    <div className="mb-2 text-xs font-black tracking-[0.16em] text-indigo-600 dark:text-indigo-200">OCR 是助手</div>
                    AI 识别结果只做草稿预填，保存前必须人工核对标题、金额、客户和签署日期，避免把识别文本当成正式合同。
                </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.activeContracts || '生效中合同'}</p>
                    <div className="flex items-center justify-between">
                        <span className="text-4xl font-black text-slate-800 dark:text-white tracking-widest">{stats.active}</span>
                        <div className="p-4 rounded-3xl bg-emerald-50 text-emerald-500">
                            <CheckCircle size={28} />
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-4">{t.totalContractValue || '合同总价'} (CNY)</p>
                    <div className="flex items-center justify-between">
                        <span className="text-2xl font-black text-slate-800 dark:text-white truncate max-w-[180px]">
                            {formatPrice(stats.totalVal)}
                        </span>
                        <div className="p-4 rounded-3xl bg-blue-50 text-blue-500">
                            <DollarSign size={28} />
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] text-rose-400 font-black uppercase tracking-widest mb-4">{t.nearExpiryTitle || '即将到期 (30天内)'}</p>
                    <div className="flex items-center justify-between">
                        <span className="text-4xl font-black text-rose-500 tracking-widest">{stats.nearExpiry}</span>
                        <div className="p-4 rounded-3xl bg-rose-50 text-rose-500">
                            <Clock size={28} />
                        </div>
                    </div>
                </div>
            </div>

            <DataTable
                tableId="contracts_list"
                title={t.contractsTitle || '全部合同'}
                columns={columns}
                data={contracts}
                isLoading={isLoading}
            />

            {/* AI OCR Modal */}
            {isOcrModalOpen && (
                <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-950 w-full max-w-4xl rounded-[40px] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h3 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white flex items-center">
                                    <Zap size={24} className="mr-3 text-indigo-500" />
                                    {t.ocrContract || 'AI 快速录入'}
                                </h3>
                            </div>
                            <button onClick={() => setIsOcrModalOpen(false)} className="p-3 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors">
                                <Plus size={24} className="rotate-45" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Upload Box */}
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`relative group h-[400px] rounded-3xl border-4 border-dashed transition-all flex flex-col items-center justify-center cursor-pointer overflow-hidden ${ocrImage ? 'border-indigo-500 bg-indigo-50/10' : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400 hover:bg-slate-50'}`}
                                >
                                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleOcrUpload} />
                                    {ocrImage ? (
                                        <img src={ocrImage} alt="Contract Preview" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center p-8 text-center">
                                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                                <FileUp size={40} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                                            </div>
                                            <p className="text-sm font-black text-slate-500 leading-relaxed max-w-[200px]">
                                                {t.aiOcrDragDrop || '点击或拖拽上传合同照片'}
                                            </p>
                                        </div>
                                    )}
                                    {isOcrProcessing && (
                                        <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center">
                                            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
                                            <p className="text-xs font-black text-indigo-600 uppercase tracking-widest animate-pulse">
                                                {t.ocrExtracting || 'AI 正在研读合同...'}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* OCR Result Form */}
                                <div className="space-y-6">
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-[32px] p-8 border border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between mb-8">
                                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">提取结果</h4>
                                            {ocrResult && (
                                                <span className="flex items-center text-emerald-600 text-[10px] font-black uppercase bg-emerald-50 px-3 py-1 rounded-full">
                                                    匹配度 {Math.round(ocrResult.confidence * 100)}%
                                                </span>
                                            )}
                                        </div>

                                        {ocrResult ? (
                                            <div className="space-y-5">
                                                <div>
                                                    <label className="text-[11px] font-black text-slate-400 uppercase mb-2 block tracking-widest">合同标题</label>
                                                    <input
                                                        type="text"
                                                        value={ocrResult.title}
                                                        onChange={e => setOcrResult({ ...ocrResult, title: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 p-4 rounded-xl border-none font-bold outline-none focus:ring-2 ring-indigo-500/20"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-[11px] font-black text-slate-400 uppercase mb-2 block tracking-widest">合同金额</label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                value={ocrResult.totalAmount}
                                                                onChange={e => setOcrResult({ ...ocrResult, totalAmount: Number(e.target.value) })}
                                                                className="w-full bg-white dark:bg-slate-900 p-4 rounded-xl border-none font-black outline-none focus:ring-2 ring-indigo-500/20"
                                                            />
                                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">CNY</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] font-black text-slate-400 uppercase mb-2 block tracking-widest">签署日期</label>
                                                        <input
                                                            type="date"
                                                            value={ocrResult.signedAt}
                                                            onChange={e => setOcrResult({ ...ocrResult, signedAt: e.target.value })}
                                                            className="w-full bg-white dark:bg-slate-900 p-4 rounded-xl border-none font-bold outline-none"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-black text-slate-400 uppercase mb-2 block tracking-widest">合作客户</label>
                                                    <select
                                                        value={ocrResult.customerId}
                                                        onChange={e => setOcrResult({ ...ocrResult, customerId: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 p-4 rounded-xl border-none font-bold outline-none"
                                                    >
                                                        <option value="">请选择客户</option>
                                                        {customers.map(c => <option key={c.id} value={c.id}>{getCustomerDisplayName(c, language)}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="h-[200px] flex flex-col items-center justify-center opacity-30 text-center">
                                                <Search size={48} className="text-slate-300 mb-4" />
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">
                                                等待上传文件并识别数据...
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {ocrResult && (
                                        <div className="flex gap-4">
                                            <button
                                                onClick={() => { setOcrImage(null); setOcrResult(null); }}
                                                className="flex-1 py-4 bg-slate-100 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] text-slate-500 hover:bg-slate-200 transition-all"
                                            >
                                                {t.clear || '清除'}
                                            </button>
                                            <button
                                                onClick={handleOcrCreate}
                                                className="flex-[2] py-4 bg-emerald-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-emerald-100 hover:bg-emerald-600 transition-all"
                                            >
                                                保存为合同草稿
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Contracts;
