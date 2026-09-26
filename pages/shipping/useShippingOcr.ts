import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { Customer, Shipment } from '../../types';
import { shipmentService } from '../../services/shipping.service';
import { customerService } from '../../src/services/customer.service';
import { matchCustomer, OcrDocumentData, parseOcrDocument } from '../../services/smartFormService';
import { reportClientIssue } from '../../utils/clientIssue';
import type { MaterialMaster } from '../../services/material.service';

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
    const [ocrMaterialQuery, setOcrMaterialQuery] = useState('');
    const [ocrMaterial, setOcrMaterial] = useState<MaterialMaster | null>(null);
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
            setOcrMaterialQuery('');
            setOcrMaterial(null);
        };
        window.addEventListener('command:ocr-shipment', handleOcr as EventListener);
        return () => window.removeEventListener('command:ocr-shipment', handleOcr as EventListener);
    }, [setActiveTab]);

    const handleOcrParse = () => {
        const normalizedText = ocrText.trim();
        const hasOnlyUploadedImages = normalizedText.startsWith('Images:') || normalizedText.startsWith('已上传');

        if (!normalizedText && !ocrImage) {
            notify('warning', t.ocrMissingText);
            return;
        }

        if (!normalizedText || hasOnlyUploadedImages) {
            notify('warning', '当前离线模式不会把图片自动识别成真实发货数据，请在文本框粘贴识别内容后再解析。');
            return;
        }

        setIsOcrProcessing(true);
        setTimeout(() => {
            const parsed = parseOcrDocument(normalizedText, 'shipment');
            setOcrResult(parsed);
            setOcrMaterialQuery(parsed.productName?.trim() || '');
            setOcrMaterial(null);
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
            setOcrText(`已上传 ${nextImages.length} 张图片，请粘贴识别文本后再解析`);
            notify('success', `已上传 ${files.length} 张图片`);
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
        setOcrMaterialQuery('');
        setOcrMaterial(null);
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
                notify('warning', '客户列表刷新失败，已先使用当前页面客户数据继续匹配');
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
        if (!ocrMaterial) {
            notify('warning', 'OCR 只提供识别建议；创建发货单前必须人工选择已发布的统一物料。');
            return;
        }

        try {
            const payload: Partial<Shipment> = {
                customerId: String(matched.id),
                materialId: String(ocrMaterial.id),
                productName: ocrMaterial.nameZh,
                quantity,
                unit: ocrMaterial.baseUnit,
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
        ocrMaterialQuery,
        ocrMaterial,
        setOcrMaterialQuery: (value: string) => {
            setOcrMaterialQuery(value);
            setOcrMaterial(null);
        },
        clearOcrMaterial: () => setOcrMaterial(null),
        selectOcrMaterial: (material: MaterialMaster) => {
            setOcrMaterial(material);
            setOcrMaterialQuery(material.nameZh);
        },
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
