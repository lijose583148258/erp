import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../app/AppContext';
import { assetService, AssetBalance, AssetTransaction, ProductBatch } from '../services/asset.service';
import { isCanceledApiError } from '../utils/api';

export const useAssets = () => {
  const { t, notify } = useAppContext();
  const [balances, setBalances] = useState<AssetBalance[]>([]);
  const [history, setHistory] = useState<AssetTransaction[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [activeTab, setActiveTab] = useState<'balance' | 'history' | 'batch'>('balance');
  const [batchKeyword, setBatchKeyword] = useState('');
  const [batchStatus, setBatchStatus] = useState<'all' | 'healthy' | 'expiring' | 'expired'>('all');
  const [batchForm, setBatchForm] = useState({
    batchNo: '',
    productName: '',
    productionDate: '',
    expiryDate: '',
    storageTemp: '',
    isColdChain: false,
    stockQuantity: '',
    unit: 'kg',
    notes: '',
  });
  const [stockUpdates, setStockUpdates] = useState<Record<number, string>>({});
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const scanFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const loadAssets = async () => {
      try {
        const [balanceRows, historyRows] = await Promise.all([
          assetService.getBalances({ signal: controller.signal }),
          assetService.getHistory({ signal: controller.signal }),
        ]);
        if (!active) return;
        setBalances(balanceRows);
        setHistory(historyRows);
      } catch (error) {
        if (isCanceledApiError(error) || !active) return;
        notify('error', t.loadDataFail);
      }
    };

    loadAssets();

    return () => {
      active = false;
      controller.abort();
    };
  }, [notify, t.loadDataFail]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const params = {
      status: batchStatus === 'all' ? undefined : batchStatus,
      keyword: batchKeyword || undefined,
    };
    assetService
      .getBatches(params, { signal: controller.signal })
      .then((rows) => {
        if (active) setBatches(rows);
      })
      .catch((error) => {
        if (isCanceledApiError(error) || !active) return;
        notify('error', t.loadDataFail);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [batchKeyword, batchStatus, notify, t.loadDataFail]);

  const stats = useMemo(() => {
    const totalItems = balances.reduce((acc, b) => acc + b.balance, 0);
    const uniqueCustomers = new Set(balances.map(b => b.customerId)).size;
    const itemsIn = history.filter(h => h.action === 'inbound').reduce((acc, h) => acc + h.quantity, 0);
    const itemsOut = history.filter(h => h.action === 'outbound').reduce((acc, h) => acc + h.quantity, 0);
    return { totalItems, uniqueCustomers, itemsIn, itemsOut };
  }, [balances, history]);

  const batchStats = useMemo(() => {
    const total = batches.length;
    const expiring = batches.filter(b => b.status === 'expiring').length;
    const expired = batches.filter(b => b.status === 'expired').length;
    const coldChain = batches.filter(b => b.isColdChain).length;
    return { total, expiring, expired, coldChain };
  }, [batches]);

  const selectedBatch = useMemo(() => {
    if (selectedBatchId === null) return null;
    return batches.find(b => b.id === selectedBatchId) || null;
  }, [batches, selectedBatchId]);

  const traceNodes = useMemo(() => {
    if (!selectedBatch) return [];
    const productionDate = new Date(selectedBatch.productionDate);
    const expiryDate = new Date(selectedBatch.expiryDate);
    const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

    const nodes = [
      { label: t.batchTraceProduction, time: productionDate, status: t.traceCompleted, location: t.traceLab },
      { label: t.batchTraceQc, time: addDays(productionDate, 2), status: t.traceCompleted, location: t.traceWarehouse },
      { label: t.batchTraceStorage, time: addDays(productionDate, 5), status: t.traceCompleted, location: t.traceWarehouse },
    ];

    if (selectedBatch.stockQuantity < 1000) {
      nodes.push({ label: t.batchTraceOutbound, time: addDays(productionDate, 8), status: t.traceCompleted, location: t.traceColdChain });
      nodes.push({ label: t.batchTraceDelivery, time: addDays(productionDate, 12), status: t.tracePending, location: t.traceCustomer });
    } else {
      nodes.push({ label: t.batchTraceOutbound, time: addDays(productionDate, 8), status: t.traceScheduled, location: t.traceColdChain });
    }

    nodes.push({
      label: t.batchTraceExpiry,
      time: expiryDate,
      status: selectedBatch.status === 'expired' ? t.traceExpired : t.traceScheduled,
      location: t.traceCompliance,
    });

    return nodes;
  }, [selectedBatch, t]);

  const handleScanApply = () => {
    const code = scanInput.trim();
    if (!code) {
      notify('warning', t.scanMissing);
      return;
    }
    const matched = batches.find(b => b.batchNo === code);
    if (!matched) {
      notify('error', t.scanNotFound);
      return;
    }
    setSelectedBatchId(matched.id);
    setScanOpen(false);
    setScanInput('');
  };

  const handleScanFile = async (file: File) => {
    if (!('BarcodeDetector' in window)) {
      notify('warning', t.scanNotSupported);
      return;
    }
    try {
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
      const imageBitmap = await createImageBitmap(file);
      const codes = await detector.detect(imageBitmap);
      if (codes.length > 0) {
        setScanInput(codes[0].rawValue || '');
      } else {
        notify('warning', t.scanNoResult);
      }
    } catch {
      notify('error', t.scanFailed);
    }
  };

  useEffect(() => {
    const handleCommandScan = () => {
      setActiveTab('batch');
      setScanOpen(true);
    };
    window.addEventListener('command:scan-asset', handleCommandScan as EventListener);
    return () => window.removeEventListener('command:scan-asset', handleCommandScan as EventListener);
  }, []);

  const handleCreateBatch = async () => {
    try {
      if (!batchForm.productName || !batchForm.productionDate || !batchForm.expiryDate || !batchForm.stockQuantity || !batchForm.unit) {
        notify('warning', t.batchMissingFields);
        return;
      }

      await assetService.createBatch({
        batchNo: batchForm.batchNo || undefined,
        productName: batchForm.productName,
        productionDate: batchForm.productionDate,
        expiryDate: batchForm.expiryDate,
        storageTemp: batchForm.storageTemp || undefined,
        isColdChain: batchForm.isColdChain,
        stockQuantity: Number(batchForm.stockQuantity),
        unit: batchForm.unit,
        notes: batchForm.notes || undefined,
      });

      notify('success', t.batchCreated);
      setBatchForm({
        batchNo: '',
        productName: '',
        productionDate: '',
        expiryDate: '',
        storageTemp: '',
        isColdChain: false,
        stockQuantity: '',
        unit: 'kg',
        notes: '',
      });
      const params = {
        status: batchStatus === 'all' ? undefined : batchStatus,
        keyword: batchKeyword || undefined,
      };
      const refreshed = await assetService.getBatches(params);
      setBatches(refreshed);
    } catch {
      notify('error', t.batchCreateFailed);
    }
  };

  const handleUpdateStock = async (id: number) => {
    const value = stockUpdates[id];
    if (value === undefined || value === '') {
      notify('warning', t.batchStockRequired);
      return;
    }
    const batch = batches.find(item => item.id === id);
    if (!batch) {
      notify('error', t.batchUpdateFailed);
      return;
    }
    try {
      const updated = await assetService.updateBatch(id, { stockQuantity: Number(value) });
      setBatches(prev => prev.map(b => b.id === id ? { ...b, ...updated } : b));
      setStockUpdates(prev => ({ ...prev, [id]: '' }));
      notify('success', `${t.batchStockUpdated}：${batch.batchNo}`);
    } catch {
      notify('error', t.batchUpdateFailed);
    }
  };

  const handleDeleteBatch = async (id: number) => {
    try {
      await assetService.deleteBatch(id);
      setBatches(prev => prev.filter(b => b.id !== id));
      notify('success', t.batchDeleted);
    } catch {
      notify('error', t.batchDeleteFailed);
    }
  };

  return {
    t,
    notify,
    balances,
    history,
    batches,
    activeTab,
    setActiveTab,
    batchKeyword,
    setBatchKeyword,
    batchStatus,
    setBatchStatus,
    batchForm,
    setBatchForm,
    stockUpdates,
    setStockUpdates,
    selectedBatchId,
    setSelectedBatchId,
    scanOpen,
    setScanOpen,
    scanInput,
    setScanInput,
    scanFileRef,
    stats,
    batchStats,
    selectedBatch,
    traceNodes,
    handleScanApply,
    handleScanFile,
    handleCreateBatch,
    handleUpdateStock,
    handleDeleteBatch,
  };
};

export default useAssets;

