import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Shipment, AssetSummary, AssetTransaction, AssetType, Customer } from '../../types';
import { useAppContext } from '../../app/AppContext';
import { shipmentService } from '../../services/shipping.service';
import { assetService } from '../../services/asset.service';
import { customerService } from '../../services/customer.service';
import { OcrDocumentData, parseOcrDocument, matchCustomer } from '../../services/smartFormService';
import { getCustomerDisplayName } from '../../utils/customerName';
import { isCanceledApiError } from '../../utils/api';
import { reportClientIssue } from '../../utils/clientIssue';
import { useShippingReceipts } from './useShippingReceipts';

export const useShipping = () => {
    const { t, notify, language } = useAppContext();
    const [activeTab, setActiveTab] = useState<'logistics' | 'assets'>('logistics');
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [assetSummaries, setAssetSummaries] = useState<AssetSummary[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);

    const [ocrText, setOcrText] = useState('');
    const [ocrResult, setOcrResult] = useState<OcrDocumentData | null>(null);
    const [isOcrProcessing, setIsOcrProcessing] = useState(false);
    const [ocrImage, setOcrImage] = useState<string | null>(null);
    const [ocrImages, setOcrImages] = useState<string[]>([]);
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [previewMode, setPreviewMode] = useState<'single' | 'gallery'>('single');

    const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
    const [aiInsights, setAiInsights] = useState<{ title: string; desc: string; level: 'low' | 'medium' | 'high' }[]>([]);

    const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
    const [assetForm, setAssetForm] = useState<{
        customerId: string;
        type: AssetType;
        quantity: number;
        action: 'outbound' | 'return';
        date: string;
        note: string;
    }>({
        customerId: '',
        type: 'Wooden Pallet',
        quantity: 1,
        action: 'outbound',
        date: new Date().toISOString().split('T')[0],
        note: ''
    });

    const receipts = useShippingReceipts({ t, notify, setShipments });
    const ocrFileInputRef = useRef<HTMLInputElement>(null);

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

    const getCustomerLabel = (customer?: Customer | null) => {
        if (!customer) return 'Unknown';
        return customer.displayName || getCustomerDisplayName(customer, language);
    };

    useEffect(() => {
        const controller = new AbortController();
        loadData(controller.signal);
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const handleOcr = () => {
            setActiveTab('logistics');
            setOcrText('');
            setOcrResult(null);
        };
        window.addEventListener('command:ocr-shipment', handleOcr as EventListener);
        return () => window.removeEventListener('command:ocr-shipment', handleOcr as EventListener);
    }, []);

    const handleOcrParse = () => {
        if (!ocrText.trim() && !ocrImage) {
            notify('warning', t.ocrMissingText);
            return;
        }

        setIsOcrProcessing(true);
        setTimeout(() => {
            const index = selectedImageIndex % 4;
            const samples = [
                'AI Extracted: Sample Chemical Co, Methanol 99.9%, CAS: 67-56-1, Batch: CH-2026-02, Qty: 2000kg',
                'AI Extracted: BioReagent Ltd, Acetonitrile 99.8%, CAS: 75-05-8, Batch: ACN-2026-02, Qty: 500kg',
                'AI Extracted: PharmaChem, Ethanol 99.9%, CAS: 64-17-5, Batch: ET-2026-02, Qty: 1200kg',
                'AI Extracted: FineChem, Toluene 99.5%, CAS: 108-88-3, Batch: TL-2026-02, Qty: 800kg'
            ];

            const text = ocrText.trim() && !ocrText.trim().startsWith('Images:')
                ? ocrText
                : (ocrImages.length > 0 ? samples[index] : (ocrText || samples[0]));

            const parsed = parseOcrDocument(text, 'shipment');
            setOcrResult(parsed);
            setIsOcrProcessing(false);
            notify('success', t.autoFillSuccess || 'Recognized successfully');
        }, 1200);
    };

    const handleOcrImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('read_failed'));
            reader.readAsDataURL(file);
        });

        try {
            const dataUrls = await Promise.all(files.map(readAsDataUrl));
            const startingIndex = ocrImages.length;
            const nextImages = [...ocrImages, ...dataUrls];
            setOcrImages(nextImages);
            setSelectedImageIndex(startingIndex);
            setOcrImage(dataUrls[0] || null);
            setPreviewMode(nextImages.length > 1 ? 'gallery' : 'single');
            setOcrText(`Images: ${nextImages.length} files uploaded for AI analysis`);
            notify('success', `Uploaded ${files.length} image(s)`);
        } catch {
            notify('error', t.imageReadFail || 'Failed to read image');
        } finally {
            e.target.value = '';
        }
    };

    const removeOcrImage = (index: number) => {
        const nextImages = ocrImages.filter((_, i) => i !== index);
        setOcrImages(nextImages);
        setPreviewMode(nextImages.length > 1 ? 'gallery' : 'single');

        if (nextImages.length === 0) {
            setOcrImage(null);
            setSelectedImageIndex(0);
            setOcrText('');
            return;
        }

        const nextIndex = Math.min(selectedImageIndex, nextImages.length - 1);
        setSelectedImageIndex(nextIndex);
        setOcrImage(nextImages[nextIndex]);
    };

    const selectImage = (index: number) => {
        setSelectedImageIndex(index);
        setOcrImage(ocrImages[index]);
    };

    const clearAllImages = () => {
        setOcrImages([]);
        setOcrImage(null);
        setSelectedImageIndex(0);
        setPreviewMode('single');
        setOcrText('');
        setOcrResult(null);
        if (ocrFileInputRef.current) {
            ocrFileInputRef.current.value = '';
        }
    };

    const togglePreviewMode = () => {
        setPreviewMode(current => (current === 'single' ? 'gallery' : 'single'));
    };

    const handleApplyOcr = async () => {
        if (!ocrResult) return;
        let candidateCustomers = customers;
        let matched = ocrResult.customerName
            ? matchCustomer(
                ocrResult.customerName,
                candidateCustomers.map(c => ({
                    id: c.id,
                    name: c.name,
                    nameZh: c.nameZh,
                    nameEn: c.nameEn,
                    nameVi: c.nameVi,
                    displayName: c.displayName
                }))
            )
            : null;

        // OCR can be applied shortly after a backend-created customer appears.
        // Refresh once before failing so the UI does not depend on a stale list.
        if (!matched && ocrResult.customerName) {
            try {
                candidateCustomers = await customerService.getAll();
                setCustomers(candidateCustomers);
                matched = matchCustomer(
                    ocrResult.customerName,
                    candidateCustomers.map(c => ({
                        id: c.id,
                        name: c.name,
                        nameZh: c.nameZh,
                        nameEn: c.nameEn,
                        nameVi: c.nameVi,
                        displayName: c.displayName
                    }))
                );
            } catch (err) {
                reportClientIssue('shipping.ocr-customer-refresh', err);
            }
        }

        if (!matched) {
            notify('error', t.ocrMissingText || '未识别到可匹配的客户名称');
            return;
        }

        const productName = ocrResult.productName?.trim();
        const quantity = Number(ocrResult.quantity);
        if (!productName || !Number.isFinite(quantity) || quantity <= 0) {
            notify('error', 'OCR 未识别到完整的发运信息，请补全品名和数量后再应用到表单');
            return;
        }

        try {
            const payload: Partial<Shipment> = {
                customerId: String(matched.id),
                productName,
                quantity,
                unit: ocrResult.unit || 'kg',
                batchNo: ocrResult.batchNo,
                carrier: ocrResult.carrier,
                trackingNo: ocrResult.trackingNo
            };
            await shipmentService.create(payload);
            notify('success', t.ocrApplied);
            setOcrText('');
            setOcrResult(null);
            loadData();
        } catch {
            notify('error', t.ocrApplyFailed);
        }
    };

    const handleAssetSubmit = async () => {
        if (!assetForm.customerId || assetForm.quantity <= 0) {
            notify('error', t.fillValidForm || 'Please fill a valid record');
            return;
        }

        const customer = customers.find(c => c.id === assetForm.customerId);
        const newTx: AssetTransaction = {
            id: '',
            date: assetForm.date,
            customerId: assetForm.customerId,
            customerName: getCustomerLabel(customer),
            customerNameZh: customer?.nameZh,
            customerNameEn: customer?.nameEn,
            customerNameVi: customer?.nameVi,
            customerDisplayName: getCustomerLabel(customer),
            type: assetForm.type,
            quantity: assetForm.quantity,
            action: assetForm.action,
            note: assetForm.note
        };

        try {
            await assetService.create(newTx);
            setIsAssetModalOpen(false);
            notify('success', t.assetSuccess || 'Asset flow recorded');
            loadData();
        } catch (err) {
            reportClientIssue('shipping.asset-submit', err);
            notify('error', t.saveFail || 'Failed to save record');
        }
    };

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
        ocrText,
        setOcrText,
        ocrResult,
        isOcrProcessing,
        ocrImage,
        ocrImages,
        selectedImageIndex,
        previewMode,
        isAiPanelOpen,
        aiInsights,
        fileInputRef: receipts.fileInputRef,
        ocrFileInputRef,
        uploadingId: receipts.uploadingId,
        receiptDrawerShipment: receipts.receiptDrawerShipment,
        receiptBundle: receipts.receiptBundle,
        receiptForm: receipts.receiptForm,
        isReceiptLoading: receipts.isReceiptLoading,
        isAssetModalOpen,
        assetForm,
        setAssetForm,
        setIsAssetModalOpen,
        loadData,
        handleOcrParse,
        handleOcrImageUpload,
        removeOcrImage,
        selectImage,
        clearAllImages,
        togglePreviewMode,
        handleApplyOcr,
        handleAssetSubmit,
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


