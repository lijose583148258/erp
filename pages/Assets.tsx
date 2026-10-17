import React from 'react';
import { History, ArrowUpRight, ArrowDownLeft, Search, Filter, Briefcase, Boxes, ClipboardList, ThermometerSnowflake, CalendarClock, AlertTriangle, PackageCheck, Trash2, QrCode, ShieldCheck } from 'lucide-react';
import useAssets from './useAssets';
import { MaterialMasterCombobox } from '../components/materials/MaterialMasterCombobox';

const Assets = () => {
    const {
        t,
        balances,
        history,
        batches,
        activeTab,
        setActiveTab,
        batchKeyword,
        setBatchKeyword,
        batchStatus,
        setBatchStatus,
        batchPage,
        setBatchPage,
        batchMeta,
        batchPageSize,
        batchForm,
        setBatchForm,
        selectedBatch,
        scanOpen,
        setScanOpen,
        scanInput,
        setScanInput,
        scanFileRef,
        stats,
        batchStats,
        traceNodes,
        handleScanApply,
        handleScanFile,
        handleCreateBatch,
        handleDeleteBatch,
        selectedBatchId,
        setSelectedBatchId,
    } = useAssets();

    const rowRenderLimit = 80;
    const visibleBalances = balances.slice(0, rowRenderLimit);
    const visibleHistory = history.slice(0, rowRenderLimit);
    const visibleBatches = batches;
    const activeTotal = activeTab === 'balance' ? balances.length : activeTab === 'history' ? history.length : batchMeta.total;
    const activeVisible = activeTab === 'batch' ? batches.length : Math.min(activeTotal, rowRenderLimit);

    return (
        <div className="space-y-10 pb-16 ">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic uppercase bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{t.assets}</h1>
                    <p className="text-blue-600 dark:text-blue-400 font-black text-xs uppercase tracking-[0.3em] mt-3 opacity-70 px-1">{t.assetHubSub}</p>
                </div>
                <div className="flex flex-wrap gap-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-2 rounded-[28px] border border-white/50 dark:border-slate-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                    <button
                        data-testid="assets-tab-balance"
                        onClick={() => setActiveTab('balance')}
                        className={`flex items-center px-8 py-3.5 rounded-[22px] text-xs font-black uppercase tracking-widest transition-colors ${activeTab === 'balance' ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
                    >
                        <Boxes size={16} className="mr-2.5" /> {t.assetBalance}
                    </button>
                    <button
                        data-testid="assets-tab-history"
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center px-8 py-3.5 rounded-[22px] text-xs font-black uppercase tracking-widest transition-colors ${activeTab === 'history' ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
                    >
                        <History size={16} className="mr-2.5" /> {t.assetHistory}
                    </button>
                    <button
                        data-testid="assets-tab-batch"
                        onClick={() => setActiveTab('batch')}
                        className={`flex items-center px-8 py-3.5 rounded-[22px] text-xs font-black uppercase tracking-widest transition-colors ${activeTab === 'batch' ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
                    >
                        <PackageCheck size={16} className="mr-2.5" /> {t.batchTracking}
                    </button>
                </div>
            </div>
            <section data-testid="assets-boundary-notice" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 text-sm font-bold leading-6 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
                    <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">
                        <ShieldCheck size={14} />
                        周转资产台账
                    </div>
                    这里只记录客户占用和归还的 IBC、托盘、桶等周转资产，不登记产品库存。
                </div>
                <div className="rounded-[28px] border border-blue-100 bg-blue-50/80 p-5 text-sm font-bold leading-6 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-200">批次追踪边界</div>
                    批次区用于查看生产日期、效期、冷链和追溯，真实入库、出库、调拨仍以生产、仓储、发货凭证为准。
                </div>
                <div className="rounded-[28px] border border-emerald-100 bg-emerald-50/80 p-5 text-sm font-bold leading-6 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-200">库存数量来源</div>
                    产品批次数量由库存凭证同步；需要补录或调整时走仓储入库或库存调整，避免手工改坏账实一致。
                </div>
            </section>
            {activeTab !== 'batch' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)] relative overflow-hidden group hover:shadow-blue-500/5 transition-colors ">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 dark:bg-blue-900/10 rounded-full -mr-16 -mt-16 "></div>
                        <div className="relative z-10">
                            <div className="p-4 bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-[22px] shadow-xl shadow-blue-500/20 w-fit mb-8 "><Briefcase size={24} /></div>
                            <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.owed}</p>
                            <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{stats.totalItems} <span className="text-sm font-bold text-slate-300 dark:text-slate-600 uppercase ml-1">件</span></p>
                        </div>
                    </div>

                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-emerald-500 text-white rounded-[22px] shadow-xl shadow-emerald-500/20 w-fit mb-8"><ArrowDownLeft size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.assetIn}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{stats.itemsIn} <span className="text-sm font-bold text-slate-300 dark:text-slate-600 ml-1">回合</span></p>
                    </div>

                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-orange-500 text-white rounded-[22px] shadow-xl shadow-orange-500/20 w-fit mb-8"><ArrowUpRight size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.assetOut}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{stats.itemsOut} <span className="text-sm font-bold text-slate-300 dark:text-slate-600 ml-1">发出</span></p>
                    </div>

                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-purple-500 text-white rounded-[22px] shadow-xl shadow-purple-500/20 w-fit mb-8"><ClipboardList size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.assetCustomer}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{stats.uniqueCustomers} <span className="text-sm font-bold text-slate-300 dark:text-slate-600 ml-1">客户</span></p>
                    </div>
                </div>
            )}
            {activeTab === 'batch' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-blue-600 text-white rounded-[22px] shadow-xl shadow-blue-500/20 w-fit mb-8"><PackageCheck size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.batchTotal}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{batchStats.total}</p>
                    </div>
                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-amber-500 text-white rounded-[22px] shadow-xl shadow-amber-500/20 w-fit mb-8"><AlertTriangle size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.batchExpiring}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{batchStats.expiring}</p>
                    </div>
                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-rose-500 text-white rounded-[22px] shadow-xl shadow-rose-500/20 w-fit mb-8"><CalendarClock size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.batchExpired}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{batchStats.expired}</p>
                    </div>
                    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
                        <div className="p-4 bg-cyan-500 text-white rounded-[22px] shadow-xl shadow-cyan-500/20 w-fit mb-8"><ThermometerSnowflake size={24} /></div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{t.batchColdChain}</p>
                        <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{batchStats.coldChain}</p>
                    </div>
                </div>
            )}

            <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-10">
                <div className="flex items-center justify-between mb-10">
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter italic uppercase flex items-center">
                        <div className="w-2 h-8 bg-blue-600 rounded-full mr-4"></div>
                        {activeTab === 'balance' ? t.assetBalance : activeTab === 'history' ? t.assetHistory : t.batchTracking}
                    </h2>
                    <div className="flex items-center text-xs font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full tracking-widest uppercase">
                        {activeVisible < activeTotal ? `${activeVisible}/${activeTotal}` : activeTotal} {t.records}
                    </div>
                </div>
                {activeTab !== 'batch' && activeTotal > rowRenderLimit && (
                    <div data-testid="assets-large-list-guard" className="mb-6 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-xs font-bold leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                        当前仅渲染前 {rowRenderLimit} 条，避免历史批次过多导致页面卡顿；请用搜索、状态筛选或批号定位需要处理的记录。
                    </div>
                )}
                {activeTab === 'batch' && (
                    <div data-testid="assets-batch-pagination" className="mb-6 flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs font-bold text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100 md:flex-row md:items-center md:justify-between">
                        <span>
                            服务端分页：第 {batchMeta.page} / {batchMeta.totalPages} 页，当前 {batches.length} / {batchMeta.total} 条，每页 {batchPageSize} 条。
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                data-testid="assets-batch-prev-page"
                                onClick={() => setBatchPage(Math.max(1, batchPage - 1))}
                                disabled={!batchMeta.hasPrevPage}
                                className="rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-xs font-black uppercase tracking-widest text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-800 dark:bg-slate-900/70 dark:text-blue-200"
                            >
                                上一页
                            </button>
                            <button
                                data-testid="assets-batch-next-page"
                                onClick={() => setBatchPage(batchPage + 1)}
                                disabled={!batchMeta.hasNextPage}
                                className="rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-xs font-black uppercase tracking-widest text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-800 dark:bg-slate-900/70 dark:text-blue-200"
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'batch' && (
                    <div className="mb-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-9 bg-white/70 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800 rounded-[28px] p-6">
                            <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-xs font-bold leading-5 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
                                批次档案补录只登记批号、效期和追溯信息，默认 0 数量；真实库存请从生产完工、仓储入库或库存调整入口形成凭证。
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <input
                                    data-testid="assets-batch-no-input"
                                    value={batchForm.batchNo}
                                    onChange={e => setBatchForm(prev => ({ ...prev, batchNo: e.target.value }))}
                                    placeholder={t.batchNo}
                                    className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                                />
                                <MaterialMasterCombobox
                                    dataTestId="assets-batch-product-input"
                                    value={batchForm.productName}
                                    selectedMaterialId={batchForm.materialId || null}
                                    onTextChange={(value) => setBatchForm(prev => ({ ...prev, productName: value, materialId: 0 }))}
                                    onClearSelection={() => setBatchForm(prev => ({ ...prev, materialId: 0 }))}
                                    onSelect={(material) => setBatchForm(prev => ({
                                        ...prev,
                                        materialId: material.id,
                                        productName: material.nameZh,
                                        unit: material.baseUnit,
                                    }))}
                                />
                                <input
                                    data-testid="assets-batch-storage-temp-input"
                                    value={batchForm.storageTemp}
                                    onChange={e => setBatchForm(prev => ({ ...prev, storageTemp: e.target.value }))}
                                    placeholder={t.batchStorageTemp}
                                    className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                                />
                                <input
                                    data-testid="assets-batch-production-date-input"
                                    type="date"
                                    value={batchForm.productionDate}
                                    onChange={e => setBatchForm(prev => ({ ...prev, productionDate: e.target.value }))}
                                    className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                                />
                                <input
                                    data-testid="assets-batch-expiry-date-input"
                                    type="date"
                                    value={batchForm.expiryDate}
                                    onChange={e => setBatchForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                                    className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                                />
                                <input
                                    data-testid="assets-batch-stock-readonly"
                                    value={batchForm.stockQuantity}
                                    readOnly
                                    title="批次数量由库存凭证同步"
                                    placeholder="0"
                                    className="cursor-not-allowed px-4 py-3 rounded-2xl bg-slate-100/80 dark:bg-slate-800/70 text-sm font-bold text-slate-400 dark:text-slate-500 border border-slate-100 dark:border-slate-700"
                                />
                                <input
                                    data-testid="assets-batch-unit-input"
                                    value={batchForm.unit}
                                    onChange={e => setBatchForm(prev => ({ ...prev, unit: e.target.value }))}
                                    readOnly={Boolean(batchForm.materialId)}
                                    placeholder={t.unit}
                                    className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                                />
                                <input
                                    data-testid="assets-batch-notes-input"
                                    value={batchForm.notes}
                                    onChange={e => setBatchForm(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder={t.notes}
                                    className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                                />
                                <label className="flex items-center gap-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                    <input
                                        data-testid="assets-batch-cold-chain-checkbox"
                                        type="checkbox"
                                        checked={batchForm.isColdChain}
                                        onChange={e => setBatchForm(prev => ({ ...prev, isColdChain: e.target.checked }))}
                                        className="w-4 h-4 accent-blue-600"
                                    />
                                    {t.batchColdChain}
                                </label>
                            </div>
                        </div>
                        <div className="lg:col-span-3 flex flex-col gap-4">
                            <input
                                ref={scanFileRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        handleScanFile(file);
                                    }
                                    e.currentTarget.value = '';
                                }}
                            />
                            <button
                                data-testid="assets-batch-create-button"
                                onClick={handleCreateBatch}
                                className="px-6 py-4 bg-blue-600 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/30 transition-colors "
                            >
                                {t.batchCreate}
                            </button>
                            <button
                                onClick={() => setScanOpen(true)}
                                className="px-6 py-4 bg-emerald-500 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-500/30 transition-colors flex items-center justify-center gap-2"
                            >
                                <QrCode size={16} /> {t.scanBatch}
                            </button>
                            <div className="flex items-center gap-3 bg-white/70 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800 rounded-[24px] px-4 py-3">
                                <Search size={16} className="text-slate-400" />
                                <input
                                    data-testid="assets-batch-search-input"
                                    value={batchKeyword}
                                    onChange={e => setBatchKeyword(e.target.value)}
                                    placeholder={t.search}
                                    className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200 w-full"
                                />
                            </div>
                            <div className="flex items-center gap-3 bg-white/70 dark:bg-slate-900/70 border border-white/60 dark:border-slate-800 rounded-[24px] px-4 py-3">
                                <Filter size={16} className="text-slate-400" />
                                <select
                                    data-testid="assets-batch-status-filter"
                                    value={batchStatus}
                                    onChange={e => setBatchStatus(e.target.value as any)}
                                    className="bg-transparent outline-none text-xs font-bold text-slate-600 dark:text-slate-200 w-full"
                                >
                                    <option value="all">{t.batchAll}</option>
                                    <option value="healthy">{t.batchHealthy}</option>
                                    <option value="expiring">{t.batchExpiring}</option>
                                    <option value="expired">{t.batchExpired}</option>
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-slate-100/50 dark:border-slate-800">
                                {activeTab !== 'batch' && (
                                    <>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{activeTab === 'balance' ? t.assetCustomer : t.status}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{activeTab === 'balance' ? t.assetType : t.assetCustomer}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{activeTab === 'balance' ? t.assetQuantity : t.assetType}</th>
                                        {activeTab === 'history' && <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.assetQuantity}</th>}
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{activeTab === 'balance' ? t.assetTime : t.assetNote}</th>
                                        {activeTab === 'history' && <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.assetTime}</th>}
                                    </>
                                )}
                                {activeTab === 'batch' && (
                                    <>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchNo}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.productName}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchProduction}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchExpiry}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchRemaining}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchStock}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchColdChain}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.batchStatus}</th>
                                        <th className="px-6 py-6 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{t.action}</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                            {activeTab === 'balance' && visibleBalances.map((row, i) => (
                                <tr key={i} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-colors group cursor-pointer">
                                    <td className="px-6 py-7 font-black text-slate-900 dark:text-white text-sm">{row.customerDisplayName || row.customerName || `ID: ${row.customerId}`}</td>
                                    <td className="px-6 py-7">
                                        <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl text-[11px] font-black uppercase tracking-widest">{row.assetType}</span>
                                    </td>
                                    <td className="px-6 py-7 font-black text-2xl text-blue-600 dark:text-blue-400 italic tracking-tighter">{row.balance}</td>
                                    <td className="px-6 py-7 text-xs text-slate-400 font-black uppercase tracking-tight">{new Date(row.updatedAt).toLocaleString()}</td>
                                </tr>
                            ))}
                            {activeTab === 'history' && visibleHistory.map((row, i) => (
                                <tr key={i} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-colors group cursor-pointer">
                                    <td className="px-6 py-7">
                                        <div className={`inline-flex items-center px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${row.action === 'inbound' ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/20 dark:border-blue-800'}`}>
                                            {row.action === 'inbound' ? <ArrowDownLeft size={10} className="mr-1.5" /> : <ArrowUpRight size={10} className="mr-1.5" />}
                                            {row.action === 'inbound' ? t.assetIn : t.assetOut}
                                        </div>
                                    </td>
                                    <td className="px-6 py-7 font-bold text-slate-900 dark:text-white text-sm">{row.customerDisplayName || row.customerName || `ID: ${row.customerId}`}</td>
                                    <td className="px-6 py-7 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">{row.assetType}</td>
                                    <td className={`px-6 py-7 font-black italic text-xl ${row.action === 'inbound' ? 'text-emerald-500' : 'text-blue-500'}`}>{row.quantity}</td>
                                    <td className="px-6 py-7 text-[11px] text-slate-400 font-bold max-w-[200px] truncate italic">{row.note || '---'}</td>
                                    <td className="px-6 py-7 text-xs text-slate-400 font-black uppercase tracking-tight">{new Date(row.createdAt).toLocaleString()}</td>
                                </tr>
                            ))}
                            {activeTab === 'batch' && visibleBatches.map(row => (
                                <tr key={row.id} data-testid={`assets-batch-row-${row.id}`} onClick={() => setSelectedBatchId(row.id)} className={`hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-colors ${selectedBatchId === row.id ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
                                    <td className="px-6 py-7 font-mono font-bold text-slate-600 dark:text-slate-300">{row.batchNo}</td>
                                    <td className="px-6 py-7 font-bold text-slate-900 dark:text-white text-sm">{row.productName}</td>
                                    <td className="px-6 py-7 text-xs text-slate-400 font-black uppercase tracking-tight">{new Date(row.productionDate).toLocaleDateString()}</td>
                                    <td className="px-6 py-7 text-xs text-slate-400 font-black uppercase tracking-tight">{new Date(row.expiryDate).toLocaleDateString()}</td>
                                    <td className="px-6 py-7 font-black text-slate-700 dark:text-slate-200 text-sm">
                                        {row.remainingDays !== undefined ? `${row.remainingDays} ${t.days}` : '-'}
                                    </td>
                                    <td className="px-6 py-7">
                                        <div className="flex flex-col gap-1">
                                            <span className="font-black text-slate-700 dark:text-slate-200 text-sm">{row.stockQuantity} {row.unit}</span>
                                            <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">凭证同步</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-7 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">
                                        {row.isColdChain ? t.yes : t.no}
                                    </td>
                                    <td className="px-6 py-7">
                                        <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${row.status === 'expired' ? 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800' : row.status === 'expiring' ? 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800' : 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800'}`}>
                                            {row.status === 'expired' ? t.batchExpired : row.status === 'expiring' ? t.batchExpiring : t.batchHealthy}
                                        </span>
                                    </td>
                                    <td className="px-6 py-7">
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                handleDeleteBatch(row.id);
                                            }}
                                            className="px-3 py-2 rounded-xl bg-rose-500 text-white text-xs font-black uppercase tracking-widest"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {activeTab === 'batch' && selectedBatch && (
                    <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
                        <div className="lg:col-span-4 bg-slate-50 dark:bg-slate-900/60 rounded-3xl p-6 border border-slate-100 dark:border-slate-800">
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{t.batchTrace}</p>
                            <h3 className="text-xl font-black text-slate-900 dark:text-white mt-3">{selectedBatch.batchNo}</h3>
                            <p className="text-sm text-slate-500 mt-2">{selectedBatch.productName}</p>
                            <div className="mt-6 space-y-3">
                                <div className="flex items-center justify-between text-xs font-bold">
                                    <span className="text-slate-400">{t.batchProduction}</span>
                                    <span className="text-slate-700 dark:text-slate-200">{new Date(selectedBatch.productionDate).toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs font-bold">
                                    <span className="text-slate-400">{t.batchExpiry}</span>
                                    <span className="text-slate-700 dark:text-slate-200">{new Date(selectedBatch.expiryDate).toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs font-bold">
                                    <span className="text-slate-400">{t.batchStock}</span>
                                    <span className="text-slate-700 dark:text-slate-200">{selectedBatch.stockQuantity} {selectedBatch.unit}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs font-bold">
                                    <span className="text-slate-400">{t.batchColdChain}</span>
                                    <span className="text-slate-700 dark:text-slate-200">{selectedBatch.isColdChain ? t.yes : t.no}</span>
                                </div>
                            </div>
                        </div>
                        <div className="lg:col-span-8 bg-white/80 dark:bg-slate-900/80 rounded-3xl p-6 border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between mb-6">
                                <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest">{t.batchTraceTimeline}</h4>
                                <div className="text-xs text-slate-400 font-black uppercase tracking-widest">{t.batchTraceNodes}: {traceNodes.length}</div>
                            </div>
                            <div className="space-y-4">
                                {traceNodes.map((node, index) => (
                                    <div key={`${node.label}-${index}`} className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-black text-xs">
                                            {index + 1}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-bold text-slate-900 dark:text-white">{node.label}</p>
                                                <span className={`px-2 py-1 rounded-full text-[11px] font-black uppercase ${node.status === t.traceCompleted ? 'bg-emerald-100 text-emerald-700' : node.status === t.traceExpired ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                                    {node.status}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase mt-1">
                                                <span>{node.location}</span>
                                                <span>{node.time.toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {scanOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-6">
                    <div className="bg-white dark:bg-slate-900 rounded-[32px] p-8 w-full max-w-lg border border-slate-100 dark:border-slate-800 shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest">{t.scanBatch}</h3>
                            <button onClick={() => setScanOpen(false)} className="text-slate-400 font-black text-xl" aria-label="关闭扫描弹窗">x</button>
                        </div>
                        <div className="space-y-4">
                            <input
                                value={scanInput}
                                onChange={e => setScanInput(e.target.value)}
                                placeholder={t.scanPlaceholder}
                                className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700"
                            />
                            <div className="flex items-center gap-3">
                                <button onClick={handleScanApply} className="flex-1 px-4 py-3 bg-emerald-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest">{t.scanApply}</button>
                                <button onClick={() => scanFileRef.current?.click()} className="flex-1 px-4 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest">{t.scanUpload}</button>
                            </div>
                            <p className="text-xs text-slate-400 font-bold uppercase">{t.scanHint}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Assets;



