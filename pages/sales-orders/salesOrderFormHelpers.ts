import { ProductBatch } from '../../services/asset.service';
import { ExtractedFormData, OcrDocumentData, matchCustomer } from '../../services/smartFormService';
import { CommissionStatus, Customer, ExtraItem, OrderStatus, SalesOrder, SalesOrderItem } from '../../types';

export const createEmptySalesOrderItem = (): SalesOrderItem => ({
    sku: '',
    productName: '',
    packagingSpec: '',
    quantity: 1,
    unit: 'kg',
    unitPrice: 0,
    discount: 0,
    taxAmount: 0,
    amount: 0,
    isDimensional: false,
    dimLength: 2440,
    dimWidth: 1220,
    dimHeight: 18,
    totalVolume: 0,
    totalWeight: 0,
});

export type SalesOrderFormData = {
    id: string;
    customerId: string;
    taxInclusive: boolean;
    paymentTermsDays: number;
    items: SalesOrderItem[];
    extraItems: ExtraItem[];
    notes: string;
    contractId: string;
    commissionRateSubmitted: number;
    commissionAmount: number;
};

export const initialOrderForm: SalesOrderFormData = {
    id: '',
    customerId: '',
    taxInclusive: true,
    paymentTermsDays: 30,
    items: [createEmptySalesOrderItem()],
    extraItems: [],
    notes: '',
    contractId: '',
    commissionRateSubmitted: 3,
    commissionAmount: 0,
};

export type PaymentForm = {
    amount: number;
    date: string;
    method: string;
    isProxy: boolean;
    payerName: string;
    note: string;
};

export const createInitialPaymentForm = (): PaymentForm => ({
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    method: 'Bank Transfer',
    isProxy: false,
    payerName: '',
    note: '',
});

export const toNumericId = (value: string) => Number(String(value || '').replace(/\D+/g, '')) || 0;

export const getOutstandingAmount = (order: SalesOrder) =>
    Math.max(0, Number(order.finalAmount || order.totalAmount || 0) - Number(order.paidAmount || 0));

export const getOverdueDays = (order: SalesOrder) => {
    if (!order.dueDate) return 0;
    const diff = new Date().getTime() - new Date(order.dueDate).getTime();
    return Math.ceil(diff / (1000 * 3600 * 24));
};

export type CollectionView = {
    label: string;
    nextAction: string;
    tone: 'emerald' | 'amber' | 'orange' | 'rose' | 'slate';
    overdueDays: number;
};

export const getCollectionView = (order: SalesOrder): CollectionView => {
    const outstanding = getOutstandingAmount(order);
    const overdueDays = Math.max(0, getOverdueDays(order));
    const financialStatus = String(order.financialStatus || order.paymentStatus || '').toLowerCase();
    const isPaid = outstanding <= 0 || financialStatus === 'paid';

    if (isPaid) {
        return { label: '已结清', nextAction: '仅保留台账与审计记录', tone: 'emerald', overdueDays };
    }

    if (financialStatus === 'payment_submitted') {
        return { label: '待财务核验', nextAction: '核对到账并更新回款状态', tone: 'amber', overdueDays };
    }

    if (financialStatus === 'partial' && overdueDays <= 0) {
        return { label: '部分回款', nextAction: '继续跟进剩余款项', tone: 'amber', overdueDays };
    }

    if (overdueDays <= 0) {
        return { label: '账期内', nextAction: '跟进预计付款时点', tone: 'slate', overdueDays };
    }

    if (overdueDays <= 15) {
        return { label: '轻提醒', nextAction: '发送提醒并确认承诺付款时间', tone: 'amber', overdueDays };
    }

    if (overdueDays <= 30) {
        return { label: '重点跟进', nextAction: '电话或邮件催收并记录结果', tone: 'orange', overdueDays };
    }

    return { label: '升级处理', nextAction: '经理复核并评估信用或发货拦截', tone: 'rose', overdueDays };
};

export const calculateOrderTotals = (formData: SalesOrderFormData) => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalCBM = 0;
    let totalWeight = 0;

    formData.items.forEach((item) => {
        const lineTotal = (item.quantity * item.unitPrice) - (item.discount || 0);
        subtotal += lineTotal;
        totalDiscount += Number(item.discount || 0);
        totalTax += Number(item.taxAmount || 0);
        if (item.isDimensional) {
            totalCBM += item.totalVolume || 0;
            totalWeight += item.totalWeight || 0;
        }
    });

    const grandTotal = subtotal + totalTax;
    const estComm = grandTotal * (formData.commissionRateSubmitted / 100);
    return { subtotal, totalDiscount, totalTax, grandTotal, estComm, totalCBM, totalWeight };
};

export const updateDimensionalItem = (item: SalesOrderItem) => {
    const next = { ...item };
    if (next.isDimensional && next.dimLength && next.dimWidth && next.dimHeight) {
        next.packagingSpec = `${next.dimLength}x${next.dimWidth}x${next.dimHeight}mm`;
        const singleVol = (next.dimLength * next.dimWidth * next.dimHeight) / 1000000000;
        next.totalVolume = Number((singleVol * next.quantity).toFixed(4));
        const density = 600;
        next.totalWeight = Number((next.totalVolume * density).toFixed(2));
    }
    if (next.unit === 'kg') next.unit = 'pcs';
    return next;
};

export const normalizeOrderItem = (item: SalesOrderItem) => {
    const normalized = { ...createEmptySalesOrderItem(), ...item };
    if (normalized.isDimensional) return updateDimensionalItem(normalized);
    return {
        ...normalized,
        totalVolume: 0,
        totalWeight: 0,
    };
};

export const parseOrderItemsFromGrid = (rawText: string) => {
    const rows = rawText
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (!rows.length) return [];

    return rows
        .map(line => line.split('\t').map(cell => cell.trim()))
        .filter(cells => cells.some(Boolean))
        .map(cells => {
            const [
                productName = '',
                packagingSpec = '',
                quantity = '1',
                unit = 'kg',
                unitPrice = '0',
                discount = '0',
                taxAmount = '0',
            ] = cells;

            return normalizeOrderItem({
                ...createEmptySalesOrderItem(),
                productName,
                packagingSpec,
                quantity: Number(quantity) || 0,
                unit: unit || 'kg',
                unitPrice: Number(unitPrice) || 0,
                discount: Number(discount) || 0,
                taxAmount: Number(taxAmount) || 0,
            });
        });
};

export const buildPriceSuggestions = (
    items: SalesOrderItem[],
    paymentTermsDays: number,
    unknownProduct: string,
    applyPrice: (index: number, unitPrice: number) => void,
) => {
    const baseMap: Record<string, number> = { PVC: 7200, PE: 7800, PP: 7600, RESIN: 8200, SOLVENT: 6800 };
    return items.map((item, index) => {
        const name = item.productName || '';
        const key = Object.keys(baseMap).find(k => name.includes(k));
        const base = key ? baseMap[key] : 8000;
        const termFactor = 1 + Math.max(0, paymentTermsDays - 30) / 300;
        const volumeFactor = item.quantity >= 50 ? 0.97 : item.quantity >= 20 ? 0.985 : 1;
        const recommended = Math.round(base * termFactor * volumeFactor);
        const floor = Math.round(recommended * 0.94);
        const ceiling = Math.round(recommended * 1.08);
        const variance = item.unitPrice ? ((item.unitPrice - recommended) / recommended) * 100 : 0;
        return {
            productName: item.productName || unknownProduct,
            recommended,
            floor,
            ceiling,
            variance,
            apply: () => applyPrice(index, recommended),
        };
    });
};

export const buildInventoryInsights = (items: SalesOrderItem[], batches: ProductBatch[], unknownProduct: string) =>
    items.map((item) => {
        const matches = batches.filter(batch => item.productName && batch.productName.includes(item.productName));
        const available = matches.reduce((sum, batch) => sum + (Number(batch.stockQuantity) || 0), 0);
        const shortage = item.quantity - available;
        return {
            productName: item.productName || unknownProduct,
            available,
            shortage,
            batches: matches.length,
            status: shortage > 0 ? 'short' : available > item.quantity * 1.5 ? 'high' : 'ok',
        };
    });

type ExtractedOrderFormData = ExtractedFormData & { customerId?: string };

export const applySmartFillToForm = (prev: SalesOrderFormData, data: ExtractedFormData): SalesOrderFormData => {
    const extracted = data as ExtractedOrderFormData;
    const updated = { ...prev };
    if (extracted.customerId) updated.customerId = extracted.customerId;
    if (data.paymentTerms) updated.paymentTermsDays = data.paymentTerms;
    if (data.notes) updated.notes = data.notes;
    if (data.productName || data.quantity || data.unitPrice) {
        const newItem = {
            ...createEmptySalesOrderItem(),
            productName: data.productName || '',
            quantity: data.quantity || 1,
            unit: data.unit || 'kg',
            unitPrice: data.unitPrice || 0,
            amount: (data.quantity || 1) * (data.unitPrice || 0),
        };
        updated.items = [newItem];
    }
    return updated;
};

export const applyOcrResultToForm = (
    prev: SalesOrderFormData,
    ocrResult: OcrDocumentData,
    customers: Customer[],
): SalesOrderFormData => {
    const updated = { ...prev };
    const matched = ocrResult.customerName
        ? matchCustomer(ocrResult.customerName, customers.map(customer => ({
            id: customer.id,
            name: customer.name,
            nameZh: customer.nameZh,
            nameEn: customer.nameEn,
            nameVi: customer.nameVi,
            nameAliases: customer.nameAliases,
            displayName: customer.displayName,
        })))
        : null;

    if (matched?.id) updated.customerId = matched.id;
    if (ocrResult.productName || ocrResult.quantity || ocrResult.unitPrice) {
        const newItem = {
            ...createEmptySalesOrderItem(),
            sku: ocrResult.batchNo || '',
            productName: ocrResult.productName || '',
            quantity: ocrResult.quantity || 1,
            unit: ocrResult.unit || 'kg',
            unitPrice: ocrResult.unitPrice || 0,
            amount: (ocrResult.quantity || 1) * (ocrResult.unitPrice || 0),
            packagingSpec: [ocrResult.casNo, ocrResult.purity].filter(Boolean).join(' / '),
        };
        updated.items = [newItem];
    }
    if (ocrResult.totalAmount && !updated.items[0]?.unitPrice) {
        updated.items = [{
            ...createEmptySalesOrderItem(),
            productName: ocrResult.productName || 'OCR 导入货品',
            quantity: 1,
            unit: ocrResult.unit || 'lot',
            unitPrice: ocrResult.totalAmount,
            amount: ocrResult.totalAmount,
        }];
    }
    if (ocrResult.address) {
        updated.notes = `${updated.notes ? updated.notes + '\n' : ''}OCR 地址: ${ocrResult.address}`;
    }
    return updated;
};

type ProductLabelScanResult = {
    name?: string;
    cas?: string;
    grade?: string;
    batchNo?: string;
};

export const saveOfflineProductScan = (fileName: string) => {
    const raw = localStorage.getItem('offline_scans') || '[]';
    const offlineScans = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    offlineScans.push({ fileName, timestamp: new Date().toISOString(), needsManualReupload: true });
    localStorage.setItem('offline_scans', JSON.stringify(offlineScans));
};

export const getOfflineProductScanCount = () => {
    const raw = localStorage.getItem('offline_scans') || '[]';
    const offlineScans = JSON.parse(raw);
    return Array.isArray(offlineScans) ? offlineScans.length : 0;
};

export const createProductScanOrderItem = (result: ProductLabelScanResult): SalesOrderItem => ({
    ...createEmptySalesOrderItem(),
    productName: result.name || '',
    casNo: result.cas,
    grade: result.grade,
    batchNo: result.batchNo,
    quantity: 1,
    unit: 'kg',
    unitPrice: 0,
});

export const mergeOrderItemIntoDraft = (items: SalesOrderItem[], item: SalesOrderItem) =>
    items.length === 1 && !items[0].productName ? [item] : [...items, item];

export type ImportedSalesOrderRow = Record<string, unknown>;

const readImportField = (row: ImportedSalesOrderRow, keys: string[]) => {
    for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
};

const readImportNumber = (row: ImportedSalesOrderRow, keys: string[], fallback = 0) => {
    const raw = readImportField(row, keys);
    const parsed = Number(raw.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const buildImportedSalesOrderPayloads = (
    rows: ImportedSalesOrderRow[],
    customers: Customer[],
    getCustomerLabel: (customer: Customer) => string,
    salespersonId: string,
): SalesOrder[] =>
    rows.map((row) => {
        const customerName = readImportField(row, ['Customer Name', 'customerName']);
        const customerId = readImportField(row, ['Customer ID', 'customerId']);
        const foundCustomer = customers.find((customer) => {
            const displayName = getCustomerLabel(customer);
            return customer.id === customerId
                || customer.name === customerName
                || customer.nameZh === customerName
                || customer.nameEn === customerName
                || customer.nameVi === customerName
                || displayName === customerName;
        });
        const totalAmount = readImportNumber(row, ['Total Amount', 'totalAmount']);
        return {
            id: '',
            customerId: String(foundCustomer?.id || ''),
            customerName: foundCustomer ? getCustomerLabel(foundCustomer) : (customerName || 'Unknown Customer'),
            customerNameZh: foundCustomer?.nameZh,
            customerNameEn: foundCustomer?.nameEn,
            customerNameVi: foundCustomer?.nameVi,
            customerDisplayName: foundCustomer ? getCustomerLabel(foundCustomer) : undefined,
            orderDate: readImportField(row, ['Order Date', 'orderDate']) || new Date().toISOString().split('T')[0],
            items: [{
                sku: readImportField(row, ['SKU', 'sku']) || 'General',
                productName: readImportField(row, ['Product', 'product']) || 'Imported Goods',
                packagingSpec: '-',
                quantity: 1,
                unit: 'lot',
                unitPrice: totalAmount,
                discount: 0,
                taxAmount: 0,
                amount: totalAmount,
                isDimensional: false,
            }],
            extraItems: [],
            taxInclusive: true,
            discountTotal: 0,
            taxTotal: 0,
            paymentTermsDays: readImportNumber(row, ['Terms', 'paymentTermsDays'], 30),
            totalAmount,
            paidAmount: 0,
            status: OrderStatus.PENDING,
            paymentStatus: 'unpaid',
            commissionAmount: 0,
            commissionStatus: CommissionStatus.PENDING,
            salespersonId,
            paymentRecords: [],
            historyLogs: [],
        };
    });
