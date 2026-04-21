import { useEffect, useMemo, useState } from 'react';
import { Shipment, AssetSummary, Customer } from '../../types';
import { useAppContext } from '../../app/AppContext';
import { shipmentService } from '../../services/shipping.service';
import { assetService } from '../../services/asset.service';
import { customerService } from '../../services/customer.service';
import { isCanceledApiError } from '../../utils/api';
import { reportClientIssue } from '../../utils/clientIssue';
import { useShippingReceipts } from './useShippingReceipts';
import { useShippingOcr } from './useShippingOcr';
import { useShippingAssets } from './useShippingAssets';

export const useShipping = () => {
    const { t, notify, language } = useAppContext();
    const [activeTab, setActiveTab] = useState<'logistics' | 'assets'>('logistics');
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [assetSummaries, setAssetSummaries] = useState<AssetSummary[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);

    const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
    const [aiInsights, setAiInsights] = useState<{ title: string; desc: string; level: 'low' | 'medium' | 'high' }[]>([]);

    const receipts = useShippingReceipts({ t, notify, setShipments });

    const loadData = async (signal?: AbortSignal) => {
        try {
            const [s, aSum, cust] = await Promise.all([
                shipmentService.getAll({ signal }),
                assetService.getSummaries({ signal }),
                customerService.getAll({ signal })
            ]);
            if (signal?.aborted) return;
            setShipments(s || []);
            setAssetSummaries(aSum || []);
            setCustomers(cust || []);
        } catch (error) {
            if (isCanceledApiError(error)) return;
            reportClientIssue('shipping.load', error);
            setShipments([]);
            setAssetSummaries([]);
            setCustomers([]);
        }
    };

    const ocr = useShippingOcr({ t, notify, customers, setCustomers, setActiveTab, loadData });
    const assets = useShippingAssets({ t, notify, language, customers, loadData });

    useEffect(() => {
        const controller = new AbortController();
        loadData(controller.signal);
        return () => controller.abort();
    }, []);

    const handleShipmentStatusUpdate = async (id: string, status: 'in_transit' | 'exception') => {
        try {
            const updatedShipment = await shipmentService.updateStatus(id, status);
            setShipments(prev => prev.map(item => item.id === id ? updatedShipment : item));
            notify('success', status === 'in_transit' ? (t.activeTransit || '已推进到在途') : (t.exception || '已标记异常'));
        } catch (err) {
            reportClientIssue('shipping.status-update', err);
            notify('error', t.saveFail || 'Failed to update status');
        }
    };

    const handleImport = (newData: Shipment[]) => {
        if (!Array.isArray(newData)) return;
        setShipments(prev => [...newData, ...prev]);
        notify('success', `${t.importSuccessCount || 'Imported successfully'} (${newData.length})`);
    };

    const laneStats = useMemo(() => {
        const map = new Map<string, { total: number; coldChain: number; avgTemp: number; countTemp: number }>();
        shipments.forEach(s => {
            const route = s.route || 'N/A';
            if (!map.has(route)) {
                map.set(route, { total: 0, coldChain: 0, avgTemp: 0, countTemp: 0 });
            }
            const entry = map.get(route)!;
            entry.total += 1;
            if (s.isColdChain) {
                entry.coldChain += 1;
            }
            if (s.temperature !== undefined) {
                entry.avgTemp += s.temperature;
                entry.countTemp += 1;
            }
        });

        return Array.from(map.entries()).map(([route, stats]) => ({
            route,
            total: stats.total,
            coldChain: stats.coldChain,
            avgTemp: stats.countTemp ? (stats.avgTemp / stats.countTemp).toFixed(1) : '-'
        }));
    }, [shipments]);

    const coldChainSeries = useMemo(() => {
        const points = 12;
        return shipments.filter(s => s.isColdChain).map((s, index) => {
            const base = s.temperature ?? 4;
            const series = Array.from({ length: points }).map((_, i) => {
                const drift = Math.sin((i + index) / 2) * 1.2 + (i % 3 === 0 ? 0.6 : -0.3);
                return Number((base + drift).toFixed(1));
            });
            const max = Math.max(...series);
            const min = Math.min(...series);
            return { shipment: s, series, max, min };
        });
    }, [shipments]);

    const generateAiInsights = () => {
        const pending = shipments.filter(s => s.status === 'pending').length;
        const exceptions = shipments.filter(s => s.status === 'exception').length;
        const missingPod = shipments.filter(s => !s.signedReceiptUrl && s.status === 'delivered').length;
        const tempAlerts = coldChainSeries.filter(({ series }) => {
            const latest = series[series.length - 1];
            return !(latest >= 2 && latest <= 8);
        }).length;

        const items: { title: string; desc: string; level: 'low' | 'medium' | 'high' }[] = [];
        if (exceptions > 0) items.push({ title: 'Logistics exceptions', desc: `There are ${exceptions} exception records that need review.`, level: exceptions > 2 ? 'high' : 'medium' });
        if (pending > 10) items.push({ title: 'Dispatch backlog', desc: `There are ${pending} pending shipments.`, level: 'medium' });
        if (tempAlerts > 0) items.push({ title: 'Cold-chain risk', desc: `${tempAlerts} temperature alerts detected.`, level: tempAlerts > 2 ? 'high' : 'medium' });
        if (missingPod > 0) items.push({ title: 'Missing POD', desc: `${missingPod} delivered shipments still lack receipt proof.`, level: 'low' });
        if (items.length === 0) items.push({ title: t.healthStatus || 'Healthy', desc: t.systemHealthyDesc || 'No material logistics risk detected.', level: 'low' });
        setAiInsights(items);
        setIsAiPanelOpen(true);
    };

    return {
        t,
        activeTab,
        setActiveTab,
        shipments,
        assetSummaries,
        customers,
        ocrText: ocr.ocrText,
        setOcrText: ocr.setOcrText,
        ocrResult: ocr.ocrResult,
        isOcrProcessing: ocr.isOcrProcessing,
        ocrImage: ocr.ocrImage,
        ocrImages: ocr.ocrImages,
        selectedImageIndex: ocr.selectedImageIndex,
        previewMode: ocr.previewMode,
        isAiPanelOpen,
        aiInsights,
        fileInputRef: receipts.fileInputRef,
        ocrFileInputRef: ocr.ocrFileInputRef,
        uploadingId: receipts.uploadingId,
        receiptDrawerShipment: receipts.receiptDrawerShipment,
        receiptBundle: receipts.receiptBundle,
        receiptForm: receipts.receiptForm,
        isReceiptLoading: receipts.isReceiptLoading,
        isAssetModalOpen: assets.isAssetModalOpen,
        assetForm: assets.assetForm,
        setAssetForm: assets.setAssetForm,
        setIsAssetModalOpen: assets.setIsAssetModalOpen,
        loadData,
        handleOcrParse: ocr.handleOcrParse,
        handleOcrImageUpload: ocr.handleOcrImageUpload,
        removeOcrImage: ocr.removeOcrImage,
        selectImage: ocr.selectImage,
        clearAllImages: ocr.clearAllImages,
        togglePreviewMode: ocr.togglePreviewMode,
        handleApplyOcr: ocr.handleApplyOcr,
        handleAssetSubmit: assets.handleAssetSubmit,
        handleFileUpload: receipts.handleFileUpload,
        handleOpenReceiptEvents: receipts.handleOpenReceiptEvents,
        handleReceiptFileChange: receipts.handleReceiptFileChange,
        handleSubmitReceiptEvent: receipts.handleSubmitReceiptEvent,
        setReceiptDrawerShipment: receipts.setReceiptDrawerShipment,
        setReceiptForm: receipts.setReceiptForm,
        handleShipmentStatusUpdate,
        handleImport,
        onFileChange: receipts.onFileChange,
        laneStats,
        coldChainSeries,
        generateAiInsights,
        setIsAiPanelOpen,
    };
};


