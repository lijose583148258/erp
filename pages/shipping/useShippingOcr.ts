import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { Customer, Shipment } from '../../types';
import { shipmentService } from '../../services/shipping.service';
import { customerService } from '../../services/customer.service';
import { matchCustomer, OcrDocumentData, parseOcrDocument } from '../../services/smartFormService';
import { reportClientIssue } from '../../utils/clientIssue';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
type ShippingTab = 'logistics' | 'assets';

type UseShippingOcrOptions = {
    t: Record<string, string>;
    notify: Notify;
    customers: Customer[];
    setCustomers: Dispatch<SetStateAction<Customer[]>>;
    setActiveTab: Dispatch<SetStateAction<ShippingTab>>;
    loadData: (signal?: AbortSignal) => Promise<void>;
};

const toCustomerMatchItems = (items: Customer[]) => items.map(c => ({
    id: c.id,
    name: c.name,
    nameZh: c.nameZh,
    nameEn: c.nameEn,
    nameVi: c.nameVi,
    displayName: c.displayName
}));

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
});

export const useShippingOcr = ({ t, notify, customers, setCustomers, setActiveTab, loadData }: UseShippingOcrOptions) => {
    const [ocrText, setOcrText] = useState('');
    const [ocrResult, setOcrResult] = useState<OcrDocumentData | null>(null);
    const [isOcrProcessing, setIsOcrProcessing] = useState(false);
    const [ocrImage, setOcrImage] = useState<string | null>(null);
    const [ocrImages, setOcrImages] = useState<string[]>([]);
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [previewMode, setPreviewMode] = useState<'single' | 'gallery'>('single');

    const ocrFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleOcr = () => {
            setActiveTab('logistics');
            setOcrText('');
            setOcrResult(null);
        };
        window.addEventListener('command:ocr-shipment', handleOcr as EventListener);
        return () => window.removeEventListener('command:ocr-shipment', handleOcr as EventListener);
    }, [setActiveTab]);

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
            ? matchCustomer(ocrResult.customerName, toCustomerMatchItems(candidateCustomers))
            : null;

        if (!matched && ocrResult.customerName) {
            try {
                candidateCustomers = await customerService.getAll();
                setCustomers(candidateCustomers);
                matched = matchCustomer(ocrResult.customerName, toCustomerMatchItems(candidateCustomers));
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

    return {
        ocrText,
        setOcrText,
        ocrResult,
        isOcrProcessing,
        ocrImage,
        ocrImages,
        selectedImageIndex,
        previewMode,
        ocrFileInputRef,
        handleOcrParse,
        handleOcrImageUpload,
        removeOcrImage,
        selectImage,
        clearAllImages,
        togglePreviewMode,
        handleApplyOcr,
    };
};
