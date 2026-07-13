import { AxiosRequestConfig, AxiosResponse, AxiosResponseHeaders, InternalAxiosRequestConfig } from 'axios';
import { Customer, SalesOrder, Shipment, AssetSummary, AssetTransaction, OrderStatus, RiskLevel } from '../types';

// 模拟延迟
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 生成随机ID
const genId = (prefix: string) => `${prefix}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

// 模拟数据库
const db = {
    customers: [] as Customer[],
    orders: [] as SalesOrder[],
    shipments: [] as Shipment[],
    assets: [] as AssetTransaction[],
    assetSummaries: [] as AssetSummary[],
    adjustments: [] as any[],
    productBatches: [] as any[],
    productionBoms: [] as any[],
    productionWorkOrders: [] as any[],
    samples: [] as any[],
    rmas: [] as any[],
    team: [] as any[],
    suppliers: [] as any[],
    purchaseOrders: [] as any[]
};

// 初始化模拟数据
let handleRequestImpl: ((config: AxiosRequestConfig) => Promise<any>) | null = null;

const initMockData = () => {
    // 客户数据
    db.customers = Array.from({ length: 20 }).map((_, i) => ({
        id: `CUST-${1000 + i}`,
        name: ['上海化工有限公司', '北京贸易集团', '广州石化公司', '深圳材料科技', '成都化学工业'][i % 5] + (i > 4 ? ` ${i}` : ''),
        contacts: [{ name: '张三', position: '经理', phone: '13800138000', email: 'zhangsan@example.com', isPrimary: true }],
        termsDays: 30,
        creditLimit: 1000000,
        usedCredit: Math.floor(Math.random() * 500000),
        overdueAmount: Math.floor(Math.random() * 150000),
        riskLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)] as RiskLevel,
        segment: i % 3 === 0 ? 'direct' : i % 3 === 1 ? 'channel' : 'mixed',
        lastOrderDate: new Date().toISOString(),
        status: 'active',
        historicalOrderCount: Math.floor(Math.random() * 50),
        avgOrderInterval: 15,
        isPublicPool: i % 4 === 0,
        poolState: i % 4 === 0 ? 'public' : i % 4 === 1 ? 'internal' : 'private',
        salespersonId: i % 4 === 0 ? null : 'U-001',
    }));

    db.orders = Array.from({ length: 15 }).map((_, i) => ({
        id: `SO-2026-${1000 + i}`,
        orderNo: `SO-2026-${1000 + i}`,
        customerId: db.customers[i % db.customers.length]?.id || `CUST-${1000 + i}`,
        customerName: db.customers[i % db.customers.length]?.name || `客户 ${i + 1}`,
        items: [],
        totalAmount: 20000 + i * 2500,
        finalAmount: 20000 + i * 2500,
        paidAmount: i % 3 === 0 ? 0 : i % 3 === 1 ? 5000 : 20000 + i * 2500,
        paymentStatus: i % 3 === 0 ? 'unpaid' : i % 3 === 1 ? 'partial' : 'paid',
        paymentTerms: 30,
        paymentTermsDays: 30,
        status: ['pending', 'confirmed', 'shipped', 'delivered'][i % 4] as OrderStatus,
        orderDate: new Date(Date.now() - i * 86400000).toISOString(),
        salespersonId: 'U-001',
        salespersonName: 'Admin User',
    } as any));

    db.shipments = db.orders.slice(0, 12).map((order, i) => ({
        id: `SH-2026-${1000 + i}`,
        orderId: order.id,
        orderNo: (order as any).orderNo || order.id,
        customerId: (order as any).customerId,
        customerName: (order as any).customerName,
        status: ['pending', 'in_transit', 'delivered', 'exception'][i % 4],
        carrier: 'SF',
        trackingNo: `SF${1000000000 + i}`,
        shippedAt: new Date(Date.now() - i * 3600000).toISOString(),
        isColdChain: i % 2 === 0,
        temperature: 4 + (i % 3),
    } as any));

    db.suppliers = Array.from({ length: 8 }).map((_, i) => ({
        id: `SUP-${1000 + i}`,
        name: `供应商 ${String.fromCharCode(65 + i)}`,
        status: 'active',
        riskLevel: ['low', 'medium', 'high'][i % 3],
    }));

    db.purchaseOrders = Array.from({ length: 6 }).map((_, i) => ({
        id: `PO-2026-${1000 + i}`,
        supplierId: db.suppliers[i % db.suppliers.length]?.id,
        supplierName: db.suppliers[i % db.suppliers.length]?.name || '',
        status: ['pending', 'approved', 'in_transit', 'received'][i % 4],
        salesOrderId: (db.orders[i % db.orders.length] as any)?.id,
        salesOrderRef: (db.orders[i % db.orders.length] as any)?.orderNo,
        isB2B: i % 2 === 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }));
    const findAdjustment = (id: string | number) => db.adjustments.find((item: any) => String(item.id) === String(id));

    const applyAdjustmentEffects = (adjustment: any) => {
        if (adjustment.domain === 'finance') {
            const order = db.orders.find((item: any) => String(item.id) === String(adjustment.orderId || adjustment.targetId)) as any;
            if (order) {
                order.paidAmount = Math.max(0, Number(order.paidAmount || 0) + Number(adjustment.amountDelta || 0));
                order.paymentStatus = order.paidAmount >= Number(order.finalAmount || order.totalAmount || 0)
                    ? 'paid'
                    : order.paidAmount > 0
                        ? 'partial'
                        : 'unpaid';
            }
            const customer = db.customers.find((item: any) => String(item.id) === String(adjustment.customerId || order?.customerId)) as any;
            if (customer) {
                customer.overdueAmount = Math.max(0, Number(customer.overdueAmount || 0) + Number(adjustment.amountDelta || 0));
            }
        }

        if (adjustment.domain === 'production' || adjustment.domain === 'inventory') {
            const batch = db.productBatches.find((item: any) => String(item.id) === String(adjustment.batchId || adjustment.targetId)) as any;
            if (batch) {
                batch.stockQuantity = Math.max(0, Number(batch.stockQuantity || 0) + Number(adjustment.quantityDelta || 0));
            }
        }
    };

    const buildAdjustmentSummary = () => {
        const summaryByDomain = (domain: string) => {
            const records = db.adjustments.filter((item: any) => item.domain === domain);
            return {
                total: records.length,
                quantityDelta: records.reduce((sum: number, item: any) => sum + Number(item.quantityDelta || 0), 0),
                amountDelta: records.reduce((sum: number, item: any) => sum + Number(item.amountDelta || 0), 0),
            };
        };

        return {
            total: db.adjustments.length,
            quantityDelta: db.adjustments.reduce((sum: number, item: any) => sum + Number(item.quantityDelta || 0), 0),
            amountDelta: db.adjustments.reduce((sum: number, item: any) => sum + Number(item.amountDelta || 0), 0),
            finance: summaryByDomain('finance'),
            production: summaryByDomain('production'),
            inventory: summaryByDomain('inventory'),
        };
    };

    const ensureCollectionsMock = () => {
        const store = db as any;
        const toNumberId = (value: any) => Number(String(value ?? '').replace(/\D+/g, '')) || Number(value) || 0;
        const findCustomer = (id: any) => store.customers.find((item: any) => String(item.id) === String(id));
        const findOrder = (id: any) => store.orders.find((item: any) => String(item.id) === String(id));
        const getDueDate = (order: any) => {
            const base = new Date(order.orderDate || order.createdAt || Date.now());
            base.setDate(base.getDate() + Number(order.paymentTermsDays || 30));
            return base;
        };
        const getOutstanding = (order: any) => Math.max(0, Number(order.finalAmount || order.totalAmount || 0) - Number(order.paidAmount || 0));
        const getDaysOverdue = (order: any) => {
            const diff = Date.now() - getDueDate(order).getTime();
            return diff > 0 ? Math.floor(diff / 86400000) : 0;
        };

        if (!store.collectionLedger) {
            store.collectionLedger = store.orders.slice(0, 10).map((order: any, index: number) => ({
                id: index + 1,
                amount: Math.max(2000, Math.round((Number(order.finalAmount || order.totalAmount || 0) * (0.18 + index * 0.03)) / 1000) * 1000),
                method: index % 2 === 0 ? 'bank_transfer' : 'cash',
                status: index < 5 ? 'verified' : 'pending',
                date: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
                note: 'mock collection payment',
                payerName: order.customerName,
                isProxy: false,
                createdAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
                verifiedBy: index < 5 ? 1 : null,
                orderId: toNumberId(order.id),
                orderNo: order.orderNo || order.id,
                contractNo: `CT-${toNumberId(order.id)}`,
                customerId: toNumberId(order.customerId),
                customerName: order.customerName,
                riskLevel: findCustomer(order.customerId)?.riskLevel || 'medium',
                finalAmount: Number(order.finalAmount || order.totalAmount || 0),
                paidAmount: Number(order.paidAmount || 0),
                paymentStatus: order.paymentStatus,
                milestoneId: index + 1,
                milestoneTitle: `节点 ${index + 1}`,
                milestonePercentage: 20,
            }));
        }

        if (!store.collectionMilestones) {
            store.collectionMilestones = store.orders.slice(0, 8).map((order: any, index: number) => ({
                id: index + 1,
                title: `回款节点 ${index + 1}`,
                percentage: 20,
                targetAmount: Math.round(Number(order.finalAmount || order.totalAmount || 0) * 0.2),
                paidAmount: Math.round(Math.max(0, Number(order.paidAmount || 0)) * 0.2),
                remainingAmount: Math.max(0, Math.round(Number(order.finalAmount || order.totalAmount || 0) * 0.2) - Math.round(Math.max(0, Number(order.paidAmount || 0)) * 0.2)),
                dueDate: getDueDate(order).toISOString(),
                status: getOutstanding(order) <= 0 ? 'paid' : 'pending',
                notes: null,
                contractId: index + 1,
                contractNo: `CT-${toNumberId(order.id)}`,
                contractTitle: `合同 ${order.orderNo || order.id}`,
                customerId: toNumberId(order.customerId),
                customerName: order.customerName,
            }));
        }

        if (!store.collectionPromises) {
            const target = store.orders.find((item: any) => getOutstanding(item) > 0) || store.orders[0];
            store.collectionPromises = [{
                id: 1,
                promiseNo: 'PTP-2026-0001',
                customerId: toNumberId(target.customerId),
                customerName: target.customerName,
                orderId: toNumberId(target.id),
                orderNo: target.orderNo || target.id,
                promisedAmount: Math.max(1000, Math.round(getOutstanding(target) * 0.6)),
                promisedAt: new Date(Date.now() + 5 * 86400000).toISOString(),
                channel: 'phone',
                contactName: target.customerName,
                contactPhone: '13800138000',
                status: 'open',
                note: 'mock promise to pay',
                createdAt: new Date().toISOString(),
            }];
        }

        if (!store.collectionDisputes) {
            const target = store.orders.find((item: any) => getOutstanding(item) > 0) || store.orders[1] || store.orders[0];
            store.collectionDisputes = [{
                id: 1,
                disputeNo: 'DSP-2026-0001',
                customerId: toNumberId(target.customerId),
                customerName: target.customerName,
                orderId: toNumberId(target.id),
                orderNo: target.orderNo || target.id,
                disputedAmount: Math.max(1000, Math.round(getOutstanding(target) * 0.4)),
                reasonCategory: 'billing',
                reason: '客户反馈对账存在差异，待复核',
                evidenceJson: null,
                status: 'reviewing',
                note: 'mock dispute',
                createdAt: new Date().toISOString(),
                resolvedAt: null,
            }];
        }

        if (!store.collectionHolds) {
            const target = store.orders.find((item: any) => getDaysOverdue(item) > 30) || store.orders[0];
            store.collectionHolds = [{
                scope: 'customer-credit',
                id: 1,
                customerId: toNumberId(target.customerId),
                customerName: target.customerName,
                orderId: null,
                orderNo: null,
                reason: '逾期超过 30 天，系统建议暂停授信',
                source: 'system',
                status: true,
                updatedAt: new Date().toISOString(),
            }];
        }

        const buildOverdue = () => store.orders.map((order: any) => {
            const customer = findCustomer(order.customerId);
            const dueDate = getDueDate(order);
            const daysOverdue = getDaysOverdue(order);
            const level = daysOverdue > 30 ? 4 : daysOverdue > 15 ? 3 : daysOverdue > 7 ? 2 : 1;
            const reminderCount = daysOverdue > 30 ? 3 : daysOverdue > 15 ? 2 : 1;
            const lastReminderAt = daysOverdue > 7 ? new Date(Date.now() - 2 * 86400000).toISOString() : null;
            return {
                orderId: toNumberId(order.id),
                orderNo: order.orderNo || order.id,
                dueDate: dueDate.toISOString(),
                daysOverdue,
                level,
                label: level >= 4 ? '法务/冻结' : level >= 3 ? '经理升级' : level >= 2 ? '电话/邮件' : '轻提醒',
                nextAction: level >= 4 ? '进入法务前置流程并暂停发货' : level >= 3 ? '经理升级并收紧信用' : level >= 2 ? '电话确认付款并登记承诺' : '发送友好提醒并确认付款日',
                channel: level >= 3 ? 'manager_escalation' : level >= 2 ? 'email_phone' : 'system_notice',
                holdRecommended: level >= 3,
                outstanding: getOutstanding(order),
                finalAmount: Number(order.finalAmount || order.totalAmount || 0),
                paidAmount: Number(order.paidAmount || 0),
                paymentStatus: order.paymentStatus,
                customerId: toNumberId(order.customerId),
                customerName: order.customerName,
                contactName: customer?.contacts?.[0]?.name || null,
                contactPhone: customer?.contacts?.[0]?.phone || null,
                ownerName: 'Admin User',
                riskLevel: customer?.riskLevel || 'medium',
                overdueAmount: Number(customer?.overdueAmount || 0),
                collectionsStatus: daysOverdue > 0 ? 'follow_up' : 'normal',
                dunningLevel: level,
                nextActionAt: new Date(Date.now() + 86400000).toISOString(),
                reminderCount,
                lastReminderAt,
                contractNo: `CT-${toNumberId(order.id)}`,
                contractTitle: `合同 ${order.orderNo || order.id}`,
            };
        }).filter((item: any) => item.outstanding > 0 && item.daysOverdue > 0).sort((a: any, b: any) => b.daysOverdue - a.daysOverdue);

        const buildSummary = () => {
            const overdue = buildOverdue();
            const receivable = store.orders.reduce((sum: number, order: any) => sum + Number(order.finalAmount || order.totalAmount || 0), 0);
            const paid = store.orders.reduce((sum: number, order: any) => sum + Number(order.paidAmount || 0), 0);
            const dueSoon = store.orders.filter((order: any) => getOutstanding(order) > 0 && getDaysOverdue(order) === 0).slice(0, 4);
            const agingBuckets = { current: 0, '1_7': 0, '8_15': 0, '16_30': 0, '31_60': 0, '60_plus': 0 } as any;
            store.orders.forEach((order: any) => {
                const outstanding = getOutstanding(order);
                if (outstanding <= 0) return;
                const days = getDaysOverdue(order);
                if (days <= 0) agingBuckets.current += outstanding;
                else if (days <= 7) agingBuckets['1_7'] += outstanding;
                else if (days <= 15) agingBuckets['8_15'] += outstanding;
                else if (days <= 30) agingBuckets['16_30'] += outstanding;
                else if (days <= 60) agingBuckets['31_60'] += outstanding;
                else agingBuckets['60_plus'] += outstanding;
            });
            return {
                totalOrders: store.orders.length,
                totalReceivable: receivable,
                totalPaid: paid,
                overdueAmount: overdue.reduce((sum: number, item: any) => sum + item.outstanding, 0),
                dueSoonAmount: dueSoon.reduce((sum: number, order: any) => sum + getOutstanding(order), 0),
                overdueCount: overdue.length,
                dueSoonCount: dueSoon.length,
                paidCount: store.orders.filter((item: any) => item.paymentStatus === 'paid').length,
                partialCount: store.orders.filter((item: any) => item.paymentStatus === 'partial').length,
                unpaidCount: store.orders.filter((item: any) => item.paymentStatus === 'unpaid').length,
                pendingVerificationCount: store.collectionLedger.filter((item: any) => item.status !== 'verified').length,
                openPromiseCount: store.collectionPromises.filter((item: any) => item.status === 'open').length,
                openPromiseAmount: store.collectionPromises.filter((item: any) => item.status === 'open').reduce((sum: number, item: any) => sum + Number(item.promisedAmount || 0), 0),
                openDisputeCount: store.collectionDisputes.filter((item: any) => item.status === 'open' || item.status === 'reviewing').length,
                creditHoldCustomerCount: store.collectionHolds.filter((item: any) => item.status && item.scope === 'customer-credit').length,
                shipmentHoldOrderCount: store.collectionHolds.filter((item: any) => item.status && item.scope === 'order-shipment').length,
                agingBuckets,
                priorityActions: overdue.slice(0, 6).map((item: any, index: number) => ({ orderId: item.orderId, orderNo: item.orderNo, customerName: item.customerName, outstanding: item.outstanding, daysOverdue: item.daysOverdue, level: item.daysOverdue > 60 ? 4 : item.daysOverdue > 30 ? 3 : item.daysOverdue > 15 ? 2 : 1, label: index === 0 ? 'critical' : 'follow', nextAction: item.daysOverdue > 30 ? '电话催收并评估拦截' : '发送提醒并确认付款计划', channel: item.daysOverdue > 30 ? 'phone' : 'wechat', holdRecommended: item.daysOverdue > 30 })),
                recentPayments: [...store.collectionLedger].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5),
            };
        };

        return { store, toNumberId, findCustomer, findOrder, getOutstanding, getDaysOverdue, buildOverdue, buildSummary };
    };

    const ensureProductionMock = () => {
        const store = db as any;
        const serialize = (value: any) => value ? new Date(value).toISOString() : null;
        const withCounts = (item: any) => ({
            ...item,
            createdAt: serialize(item.createdAt),
            updatedAt: serialize(item.updatedAt),
        });
        const findWorkOrder = (id: any) => store.productionWorkOrders.find((item: any) => String(item.id) === String(id));
        const findBatch = (id: any) => store.productBatches.find((item: any) => String(item.id) === String(id));

        const summary = () => {
            const workOrders = store.productionWorkOrders;
            const qcChecks = workOrders.flatMap((item: any) => item.qualityChecks || []);
            const totalTarget = workOrders.reduce((sum: number, item: any) => sum + Number(item.targetQuantity || 0), 0);
            const totalProduced = workOrders.reduce((sum: number, item: any) => sum + Number(item.producedQuantity || 0), 0);
            const totalLoss = workOrders.reduce((sum: number, item: any) => sum + Number(item.lossQuantity || 0), 0);
            return {
                bomCount: store.productionBoms.length,
                workOrderCount: workOrders.length,
                batchCount: store.productBatches.length,
                activeWorkOrders: workOrders.filter((item: any) => ['planned', 'in_progress', 'qc_pending'].includes(item.status)).length,
                completedWorkOrders: workOrders.filter((item: any) => item.status === 'completed').length,
                qcPendingCount: workOrders.filter((item: any) => item.status === 'qc_pending').length,
                totalTargetQuantity: totalTarget,
                totalProducedQuantity: totalProduced,
                totalLossQuantity: totalLoss,
                passCount: qcChecks.filter((item: any) => item.result === 'pass').length,
                failCount: qcChecks.filter((item: any) => item.result === 'fail').length,
                recentWorkOrders: workOrders.slice(0, 5).map((item: any) => ({
                    ...item,
                    plannedStartAt: serialize(item.plannedStartAt),
                    plannedEndAt: serialize(item.plannedEndAt),
                    actualStartAt: serialize(item.actualStartAt),
                    actualEndAt: serialize(item.actualEndAt),
                    createdAt: serialize(item.createdAt),
                    updatedAt: serialize(item.updatedAt),
                })),
            };
        };

        return { store, serialize, withCounts, findWorkOrder, findBatch, summary };
    };

    const parseBody = (rawData: any) => {
        if (!rawData) return {};
        if (typeof rawData === 'string') {
            try {
                return JSON.parse(rawData);
            } catch {
                return {};
            }
        }
        return rawData;
    };

    const handleRequest = async (config: AxiosRequestConfig): Promise<any> => {
        const path = String(config.url || '').replace('/api', '') || '';
        const method = String(config.method || 'get').toLowerCase();
        const body = parseBody(config.data);
        const params = (config.params || {}) as Record<string, any>;

    // Auth
    if (path === '/auth/login') {
        return {
            token: 'mock-token-' + Date.now(),
            user: { id: 1, username: body.username, role: 'admin' }
        };
    }

    // Customers
    if (path === '/customers' && method === 'get') return db.customers;
    if (path === '/customers' && method === 'post') {
        const poolState = body.poolState || (body.salespersonId ? 'private' : 'internal');
        const newCust = { ...body, id: genId('CUST'), poolState, isPublicPool: poolState === 'public' };
        db.customers.unshift(newCust);
        return newCust;
    }
    if (path.startsWith('/customers/') && path.endsWith('/pool') && method === 'patch') {
        const customerId = path.split('/')[2];
        const customer = db.customers.find((item: any) => String(item.id) === String(customerId));
        if (!customer) throw new Error('Customer not found');
        customer.poolState = body.poolState;
        customer.poolReason = body.reason || null;
        customer.poolUpdatedAt = new Date().toISOString();
        customer.salespersonId = body.poolState === 'private' ? (body.salespersonId || customer.salespersonId || 'U-001') : null;
        customer.isPublicPool = body.poolState === 'public';
        customer.assignedSalespersonId = customer.salespersonId ? String(customer.salespersonId) : undefined;
        return customer;
    }

    // Orders
    if (path === '/orders' && method === 'get') return db.orders;
    if (path === '/orders' && method === 'post') {
        const newOrder = { ...body, id: genId('SO'), orderDate: new Date().toISOString() };
        db.orders.unshift(newOrder);
        return newOrder;
    }

    // Shipments
    if (path.startsWith('/shipments') && method === 'get') return db.shipments;
    if (path === '/shipments' && method === 'post') {
        const newShip = { ...body, id: genId('SH') };
        db.shipments.unshift(newShip);
        return newShip;
    }

    // Procurement
    if (path === '/procurement/suppliers' && method === 'get') return db.suppliers;
    if (path === '/procurement/suppliers' && method === 'post') {
        const newSupplier = { ...body, id: genId('SUP'), status: body.status || 'active' };
        db.suppliers.unshift(newSupplier);
        return newSupplier;
    }
    if (path === '/procurement/orders' && method === 'get') return db.purchaseOrders;
    if (path === '/procurement/orders' && method === 'post') {
        const supplier = db.suppliers.find((s: any) => s.id === body.supplierId);
        const newOrder = {
            ...body,
            id: genId('PO'),
            supplierName: supplier?.name || body.supplierName || '',
            status: body.status || 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        db.purchaseOrders.unshift(newOrder);
        return newOrder;
    }
    if (path.startsWith('/procurement/orders/') && path.endsWith('/status') && method === 'patch') {
        const id = path.split('/')[3];
        const order = db.purchaseOrders.find((o: any) => o.id === id);
        if (order) {
            order.status = body.status;
            order.updatedAt = new Date().toISOString();
        }
        return order;
    }
    if (path.startsWith('/procurement/orders/') && path.endsWith('/link-b2b') && method === 'post') {
        const id = path.split('/')[3];
        const order = db.purchaseOrders.find((o: any) => o.id === id);
        const salesOrder = db.orders.find((o: any) => o.id === body.salesOrderId);
        if (order && salesOrder) {
            order.salesOrderId = salesOrder.id;
            order.salesOrderRef = (salesOrder as any).orderNo || salesOrder.id;
            order.isB2B = true;
            order.updatedAt = new Date().toISOString();
            return { purchaseOrder: order, salesOrder };
        }
        return { purchaseOrder: null, salesOrder: null };
    }
    if (path.startsWith('/procurement/b2b-status/') && method === 'get') {
        const salesOrderId = path.split('/')[3];
        const order = db.purchaseOrders.find((o: any) => o.salesOrderId === salesOrderId);
        return { linked: Boolean(order), purchaseOrder: order };
    }
    if (path.startsWith('/procurement/sync-b2b/') && method === 'post') {
        const salesOrderId = path.split('/')[3];
        const order = db.purchaseOrders.find((o: any) => o.salesOrderId === salesOrderId);
        if (order) {
            const statusMap: Record<string, string> = {
                pending: 'pending',
                confirmed: 'approved',
                shipped: 'in_transit',
                delivered: 'received',
                cancelled: 'pending'
            };
            order.status = statusMap[String(body.salesStatus)] || order.status;
            order.updatedAt = new Date().toISOString();
        }
        return { purchaseOrder: order, salesOrder: db.orders.find((o: any) => o.id === salesOrderId) };
    }

    // Assets
    if (path.includes('/assets/summaries')) return db.assetSummaries;
    if (path.includes('/assets') && method === 'get') return db.assets;

    // Adjustments
    if (path === '/adjustments/summary' && method === 'get') return buildAdjustmentSummary();
    if (path === '/adjustments' && method === 'get') {
        const { domain, status, targetType } = params;
        let adjustments = [...db.adjustments];
        if (domain) adjustments = adjustments.filter((item: any) => item.domain === domain);
        if (status) adjustments = adjustments.filter((item: any) => item.status === status);
        if (targetType) adjustments = adjustments.filter((item: any) => item.targetType === targetType);
        return {
            success: true,
            data: adjustments,
            meta: {
                page: Number(params.page || 1),
                pageSize: Number(params.pageSize || adjustments.length || 1),
                total: adjustments.length,
                totalPages: 1,
            },
        };
    }
    if (path.startsWith('/adjustments/') && path.split('/').length === 3 && method === 'get') {
        const id = path.split('/')[2];
        return findAdjustment(id);
    }
    if (path === '/adjustments' && method === 'post') {
        const newAdjustment = {
            id: db.adjustments.length + 1,
            adjustmentNo: `ADJ-${Date.now()}`,
            ...body,
            createdBy: 1,
            status: body.status || 'posted',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        db.adjustments.unshift(newAdjustment);
        if (newAdjustment.status === 'posted') {
            applyAdjustmentEffects(newAdjustment);
        }
        return { success: true, data: { adjustment: newAdjustment, effects: {} } };
    }
    if (path.startsWith('/adjustments/') && path.endsWith('/apply') && method === 'post') {
        const id = path.split('/')[2];
        const adjustment = findAdjustment(id);
        if (adjustment) {
            adjustment.status = 'posted';
            adjustment.appliedAt = new Date().toISOString();
            applyAdjustmentEffects(adjustment);
        }
        return { success: true, data: { adjustment, effects: {} } };
    }
    if (path.startsWith('/adjustments/') && path.endsWith('/reverse') && method === 'post') {
        const id = path.split('/')[2];
        const original = findAdjustment(id);
        if (!original) return { success: true, data: { original: null, reverse: null } };
        const reverse = {
            id: db.adjustments.length + 1,
            adjustmentNo: `ADJ-${Date.now()}-R`,
            domain: original.domain,
            targetType: original.targetType,
            targetId: original.targetId,
            targetRef: original.targetRef,
            orderId: original.orderId,
            orderNo: original.orderNo,
            batchId: original.batchId,
            batchNo: original.batchNo,
            productName: original.productName,
            customerId: original.customerId,
            customerName: original.customerName,
            quantityDelta: Number(original.quantityDelta || 0) * -1,
            amountDelta: Number(original.amountDelta || 0) * -1,
            reason: `冲销：${body.note || '人工冲销'}`,
            reasonCategory: original.reasonCategory,
            lossType: original.lossType,
            note: body.note || '人工冲销',
            status: 'posted',
            createdBy: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        original.status = 'reversed';
        db.adjustments.unshift(reverse);
        applyAdjustmentEffects(reverse);
        return { success: true, data: { original, reverse } };
    }

    // Production
    if (path === '/production/summary' && method === 'get') {
        const { summary } = ensureProductionMock();
        return summary();
    }
    if (path === '/production/boms' && method === 'get') {
        const { store, serialize } = ensureProductionMock();
        return store.productionBoms.map((item: any) => ({
            ...item,
            createdAt: serialize(item.createdAt),
            updatedAt: serialize(item.updatedAt),
        }));
    }
    if (path === '/production/boms' && method === 'post') {
        const { store, serialize } = ensureProductionMock();
        const bom = {
            id: store.productionBoms.length + 1,
            bomNo: `BOM-${Date.now()}`,
            productName: body.productName,
            version: body.version || 'v1',
            outputUnit: body.outputUnit,
            notes: body.notes || null,
            createdBy: 1,
            creator: { id: 1, username: 'admin', role: 'admin' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: (body.items || []).map((item: any, index: number) => ({
                id: index + 1,
                materialName: item.materialName,
                quantityPerUnit: Number(item.quantityPerUnit || 0),
                unit: item.unit || 'kg',
                lossRate: Number(item.lossRate || 0),
                notes: item.notes || null,
            })),
            workOrders: [],
        };
        store.productionBoms.unshift(bom);
        return { ...bom, createdAt: serialize(bom.createdAt), updatedAt: serialize(bom.updatedAt) };
    }
    if (path === '/production/work-orders' && method === 'get') {
        const { store, serialize } = ensureProductionMock();
        let workOrders = [...store.productionWorkOrders];
        if (params.status) workOrders = workOrders.filter((item: any) => item.status === params.status);
        if (params.bomId) workOrders = workOrders.filter((item: any) => String(item.bomId) === String(params.bomId));
        if (params.batchId) workOrders = workOrders.filter((item: any) => String(item.batchId) === String(params.batchId));
        if (params.keyword) {
            const keyword = String(params.keyword).toLowerCase();
            workOrders = workOrders.filter((item: any) => String(item.workOrderNo).toLowerCase().includes(keyword) || String(item.productName).toLowerCase().includes(keyword));
        }
        return workOrders.map((item: any) => ({
            ...item,
            plannedStartAt: serialize(item.plannedStartAt),
            plannedEndAt: serialize(item.plannedEndAt),
            actualStartAt: serialize(item.actualStartAt),
            actualEndAt: serialize(item.actualEndAt),
            createdAt: serialize(item.createdAt),
            updatedAt: serialize(item.updatedAt),
            steps: (item.steps || []).map((step: any) => ({
                ...step,
                startedAt: serialize(step.startedAt),
                completedAt: serialize(step.completedAt),
            })),
            qualityChecks: (item.qualityChecks || []).map((check: any) => ({
                ...check,
                checkedAt: serialize(check.checkedAt),
                createdAt: serialize(check.createdAt),
                updatedAt: serialize(check.updatedAt),
            })),
            bom: item.bomId ? store.productionBoms.find((bom: any) => String(bom.id) === String(item.bomId)) || null : null,
            productBatch: item.batchId ? store.productBatches.find((batch: any) => String(batch.id) === String(item.batchId)) || null : null,
        }));
    }
    if (path === '/production/work-orders' && method === 'post') {
        const { store, serialize, findBatch } = ensureProductionMock();
        const workOrder = {
            id: store.productionWorkOrders.length + 1,
            workOrderNo: `WO-${Date.now()}`,
            bomId: body.bomId ?? null,
            batchId: body.batchId ?? null,
            productName: body.productName,
            targetQuantity: Number(body.targetQuantity || 0),
            producedQuantity: Number(body.producedQuantity || 0),
            lossQuantity: Number(body.lossQuantity || 0),
            status: 'planned',
            plannedStartAt: body.plannedStartAt || null,
            plannedEndAt: body.plannedEndAt || null,
            actualStartAt: null,
            actualEndAt: null,
            note: body.note || null,
            createdBy: 1,
            creator: { id: 1, username: 'admin', role: 'admin' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            steps: (body.steps || [{ stepNo: 1, title: '备料' }, { stepNo: 2, title: '生产' }, { stepNo: 3, title: '质检' }]).map((step: any, index: number) => ({
                id: index + 1,
                workOrderId: store.productionWorkOrders.length + 1,
                stepNo: step.stepNo || index + 1,
                title: step.title,
                status: 'pending',
                operatorName: step.operatorName || null,
                startedAt: null,
                completedAt: null,
                note: step.note || null,
            })),
            qualityChecks: [],
        };
        store.productionWorkOrders.unshift(workOrder);
        const bom = body.bomId ? store.productionBoms.find((item: any) => String(item.id) === String(body.bomId)) : null;
        if (bom) {
            bom.workOrders = bom.workOrders || [];
            bom.workOrders.unshift({
                id: workOrder.id,
                workOrderNo: workOrder.workOrderNo,
                status: workOrder.status,
                targetQuantity: workOrder.targetQuantity,
                producedQuantity: workOrder.producedQuantity,
                lossQuantity: workOrder.lossQuantity,
            });
        }
        const batch = body.batchId ? findBatch(body.batchId) : null;
        return {
            ...workOrder,
            plannedStartAt: serialize(workOrder.plannedStartAt),
            plannedEndAt: serialize(workOrder.plannedEndAt),
            actualStartAt: null,
            actualEndAt: null,
            createdAt: serialize(workOrder.createdAt),
            updatedAt: serialize(workOrder.updatedAt),
            steps: workOrder.steps.map((step: any) => ({ ...step, startedAt: null, completedAt: null })),
            qualityChecks: [],
            bom,
            productBatch: batch || null,
        };
    }
    if (path.startsWith('/production/work-orders/') && path.endsWith('/status') && method === 'patch') {
        const { store, serialize, findBatch } = ensureProductionMock();
        const id = path.split('/')[3];
        const workOrder = store.productionWorkOrders.find((item: any) => String(item.id) === String(id));
        if (!workOrder) return null;
        workOrder.status = body.status;
        if (body.status === 'in_progress' && !workOrder.actualStartAt) workOrder.actualStartAt = new Date().toISOString();
        if (body.status === 'completed') {
            workOrder.actualEndAt = new Date().toISOString();
            const netOutput = Math.max(0, Number(workOrder.producedQuantity || 0) - Number(workOrder.lossQuantity || 0));
            if (netOutput > 0) {
                const batch = workOrder.batchId ? findBatch(workOrder.batchId) : null;
                if (batch) {
                    batch.stockQuantity = Number(batch.stockQuantity || 0) + netOutput;
                } else {
                    const createdBatch = {
                        id: store.productBatches.length + 1,
                        batchNo: `BATCH-${Date.now()}`,
                        productName: workOrder.productName,
                        productionDate: new Date().toISOString(),
                        expiryDate: new Date(Date.now() + 365 * 86400000).toISOString(),
                        stockQuantity: netOutput,
                        unit: 'kg',
                        isColdChain: false,
                        status: 'healthy',
                    };
                    store.productBatches.unshift(createdBatch);
                    workOrder.batchId = createdBatch.id;
                }
            }
        }
        workOrder.updatedAt = new Date().toISOString();
        return {
            ...workOrder,
            plannedStartAt: serialize(workOrder.plannedStartAt),
            plannedEndAt: serialize(workOrder.plannedEndAt),
            actualStartAt: serialize(workOrder.actualStartAt),
            actualEndAt: serialize(workOrder.actualEndAt),
            createdAt: serialize(workOrder.createdAt),
            updatedAt: serialize(workOrder.updatedAt),
            steps: workOrder.steps.map((step: any) => ({ ...step, startedAt: serialize(step.startedAt), completedAt: serialize(step.completedAt) })),
            qualityChecks: workOrder.qualityChecks.map((check: any) => ({ ...check, checkedAt: serialize(check.checkedAt), createdAt: serialize(check.createdAt), updatedAt: serialize(check.updatedAt) })),
            bom: workOrder.bomId ? store.productionBoms.find((bom: any) => String(bom.id) === String(workOrder.bomId)) || null : null,
            productBatch: workOrder.batchId ? store.productBatches.find((batch: any) => String(batch.id) === String(workOrder.batchId)) || null : null,
        };
    }
    if (path.startsWith('/production/work-orders/') && path.includes('/steps/') && method === 'patch') {
        const { store, serialize } = ensureProductionMock();
        const parts = path.split('/');
        const id = parts[3];
        const stepId = parts[5];
        const workOrder = store.productionWorkOrders.find((item: any) => String(item.id) === String(id));
        const step = workOrder?.steps?.find((item: any) => String(item.id) === String(stepId));
        if (!step) return null;
        if (body.status) step.status = body.status;
        if (body.operatorName !== undefined) step.operatorName = body.operatorName;
        if (body.note !== undefined) step.note = body.note;
        if (body.status === 'in_progress' && !step.startedAt) step.startedAt = new Date().toISOString();
        if (body.status === 'completed') step.completedAt = new Date().toISOString();
        return { ...step, startedAt: serialize(step.startedAt), completedAt: serialize(step.completedAt) };
    }
    if (path.startsWith('/production/work-orders/') && path.endsWith('/checks') && method === 'post') {
        const { store, serialize } = ensureProductionMock();
        const id = path.split('/')[3];
        const workOrder = store.productionWorkOrders.find((item: any) => String(item.id) === String(id));
        if (!workOrder) return null;
        const check = {
            id: (workOrder.qualityChecks?.length || 0) + 1,
            workOrderId: workOrder.id,
            checkNo: `QC-${Date.now()}`,
            result: body.result || 'pending',
            defectRate: body.defectRate ?? null,
            note: body.note || null,
            checkedBy: body.checkedBy || null,
            checkedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        workOrder.qualityChecks = workOrder.qualityChecks || [];
        workOrder.qualityChecks.unshift(check);
        return { ...check, checkedAt: serialize(check.checkedAt), createdAt: serialize(check.createdAt), updatedAt: serialize(check.updatedAt) };
    }

    if (path === '/collections/summary' && method === 'get') {
        const { buildSummary } = ensureCollectionsMock();
        return buildSummary();
    }
    if (path.startsWith('/collections/ledger') && method === 'get') {
        const { store } = ensureCollectionsMock();
        return [...store.collectionLedger].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }
    if (path.startsWith('/collections/overdue') && method === 'get') {
        const { buildOverdue } = ensureCollectionsMock();
        return buildOverdue();
    }
    if (path === '/collections/milestones' && method === 'get') {
        const { store } = ensureCollectionsMock();
        return store.collectionMilestones;
    }
    if (path === '/collections/promises' && method === 'get') {
        const { store } = ensureCollectionsMock();
        return store.collectionPromises;
    }
    if (path === '/collections/disputes' && method === 'get') {
        const { store } = ensureCollectionsMock();
        return store.collectionDisputes;
    }
    if (path === '/collections/holds' && method === 'get') {
        const { store } = ensureCollectionsMock();
        return store.collectionHolds;
    }
    if (path === '/collections/sync-overdue' && method === 'post') {
        const { buildOverdue, store, toNumberId } = ensureCollectionsMock();
        const overdue = buildOverdue();
        const touched = new Set<string>();
        store.customers.forEach((customer: any) => {
            customer.overdueAmount = overdue.filter((item: any) => String(item.customerId) === String(toNumberId(customer.id))).reduce((sum: number, item: any) => sum + Number(item.outstanding || 0), 0);
            if (customer.overdueAmount > 0) touched.add(String(customer.id));
        });
        return { updatedCustomers: touched.size };
    }
    if (path.startsWith('/collections/payments/') && path.endsWith('/verify') && method === 'post') {
        const { store, findOrder, findCustomer, getOutstanding } = ensureCollectionsMock();
        const paymentId = path.split('/')[3];
        const payment = store.collectionLedger.find((item: any) => String(item.id) === String(paymentId));
        if (payment && payment.status !== 'verified') {
            payment.status = 'verified';
            payment.verifiedBy = 1;
            const order = findOrder(payment.orderId);
            if (order) {
                order.paidAmount = Number(order.paidAmount || 0) + Number(payment.amount || 0);
                order.paymentStatus = getOutstanding(order) <= 0 ? 'paid' : Number(order.paidAmount || 0) > 0 ? 'partial' : 'unpaid';
                const customer = findCustomer(order.customerId);
                if (customer) customer.overdueAmount = Math.max(0, Number(customer.overdueAmount || 0) - Number(payment.amount || 0));
            }
        }
        return { success: true, data: payment };
    }
    if (path.startsWith('/collections/orders/') && path.endsWith('/remind') && method === 'post') {
        return { success: true, data: { reminded: true, remindedAt: new Date().toISOString() } };
    }
    if (path === '/collections/promises' && method === 'post') {
        const { store, findCustomer, findOrder, toNumberId } = ensureCollectionsMock();
        const order = findOrder(body.orderId);
        const customer = findCustomer(body.customerId || order?.customerId);
        const nextId = (store.collectionPromises.at(-1)?.id || 0) + 1;
        const record = { id: nextId, promiseNo: `PTP-${Date.now()}`, customerId: toNumberId(body.customerId || order?.customerId), customerName: customer?.name || order?.customerName || body.customerName || '未知客户', orderId: toNumberId(body.orderId), orderNo: order?.orderNo || body.orderNo || String(body.orderId), promisedAmount: Number(body.promisedAmount || 0), promisedAt: body.promisedAt, channel: body.channel || 'phone', contactName: body.contactName || customer?.contacts?.[0]?.name || null, contactPhone: body.contactPhone || customer?.contacts?.[0]?.phone || null, status: 'open', note: body.note || null, createdAt: new Date().toISOString() };
        store.collectionPromises.push(record);
        return record;
    }
    if (path.startsWith('/collections/promises/') && path.endsWith('/status') && method === 'patch') {
        const { store } = ensureCollectionsMock();
        const promiseId = path.split('/')[3];
        const record = store.collectionPromises.find((item: any) => String(item.id) === String(promiseId));
        if (record) record.status = body.status;
        return { success: true, data: record };
    }
    if (path === '/collections/disputes' && method === 'post') {
        const { store, findCustomer, findOrder, toNumberId } = ensureCollectionsMock();
        const order = findOrder(body.orderId);
        const customer = findCustomer(body.customerId || order?.customerId);
        const nextId = (store.collectionDisputes.at(-1)?.id || 0) + 1;
        const record = { id: nextId, disputeNo: `DSP-${Date.now()}`, customerId: toNumberId(body.customerId || order?.customerId), customerName: customer?.name || order?.customerName || body.customerName || '未知客户', orderId: toNumberId(body.orderId), orderNo: order?.orderNo || body.orderNo || String(body.orderId), disputedAmount: body.disputedAmount ?? null, reasonCategory: body.reasonCategory || 'billing', reason: body.reason || '待复核', evidenceJson: body.evidenceJson || null, status: 'open', note: body.note || null, createdAt: new Date().toISOString(), resolvedAt: null };
        store.collectionDisputes.push(record);
        return record;
    }
    if (path.startsWith('/collections/disputes/') && path.endsWith('/status') && method === 'patch') {
        const { store } = ensureCollectionsMock();
        const disputeId = path.split('/')[3];
        const record = store.collectionDisputes.find((item: any) => String(item.id) === String(disputeId));
        if (record) {
            record.status = body.status;
            record.resolvedAt = body.status === 'resolved' ? new Date().toISOString() : null;
        }
        return { success: true, data: record };
    }
    if (path.startsWith('/collections/customers/') && path.endsWith('/hold') && method === 'post') {
        const { store, findCustomer, toNumberId } = ensureCollectionsMock();
        const customerId = path.split('/')[3];
        const customer = findCustomer(customerId);
        const scope = body.type === 'shipment' ? 'customer-shipment' : 'customer-credit';
        const existing = store.collectionHolds.find((item: any) => item.scope === scope && String(item.customerId) === String(toNumberId(customerId)));
        if (existing) {
            existing.reason = body.reason;
            existing.source = body.source || 'manual';
            existing.status = true;
            existing.updatedAt = new Date().toISOString();
            return { success: true, data: existing };
        }
        const record = { scope, id: (store.collectionHolds.at(-1)?.id || 0) + 1, customerId: toNumberId(customerId), customerName: customer?.name || '未知客户', orderId: null, orderNo: null, reason: body.reason || null, source: body.source || 'manual', status: true, updatedAt: new Date().toISOString() };
        store.collectionHolds.push(record);
        return { success: true, data: record };
    }
    if (path.startsWith('/collections/customers/') && path.endsWith('/hold') && method === 'delete') {
        const { store, toNumberId } = ensureCollectionsMock();
        const customerId = path.split('/')[3];
        const scope = body.type === 'shipment' ? 'customer-shipment' : 'customer-credit';
        store.collectionHolds = store.collectionHolds.map((item: any) => item.scope === scope && String(item.customerId) === String(toNumberId(customerId)) ? { ...item, status: false, updatedAt: new Date().toISOString() } : item);
        return { success: true };
    }
    if (path.startsWith('/collections/orders/') && path.endsWith('/shipment-hold') && method === 'post') {
        const { store, findOrder, toNumberId } = ensureCollectionsMock();
        const orderId = path.split('/')[3];
        const order = findOrder(orderId);
        const existing = store.collectionHolds.find((item: any) => item.scope === 'order-shipment' && String(item.orderId) === String(toNumberId(orderId)));
        if (existing) {
            existing.reason = body.reason;
            existing.source = body.source || 'manual';
            existing.status = true;
            existing.updatedAt = new Date().toISOString();
            return { success: true, data: existing };
        }
        const record = { scope: 'order-shipment', id: (store.collectionHolds.at(-1)?.id || 0) + 1, customerId: toNumberId(order?.customerId), customerName: order?.customerName || '未知客户', orderId: toNumberId(orderId), orderNo: order?.orderNo || String(orderId), reason: body.reason || null, source: body.source || 'manual', status: true, updatedAt: new Date().toISOString() };
        store.collectionHolds.push(record);
        return { success: true, data: record };
    }
    if (path.startsWith('/collections/orders/') && path.endsWith('/shipment-hold') && method === 'delete') {
        const { store, toNumberId } = ensureCollectionsMock();
        const orderId = path.split('/')[3];
        store.collectionHolds = store.collectionHolds.map((item: any) => item.scope === 'order-shipment' && String(item.orderId) === String(toNumberId(orderId)) ? { ...item, status: false, updatedAt: new Date().toISOString() } : item);
        return { success: true };
    }
    // Dashboard
    if (path === '/dashboard' && method === 'get') {
        return {
            overview: {
                totalCustomers: db.customers.length,
                activeCustomers: db.customers.filter(c => c.status === 'active').length,
                totalOrders: db.orders.length,
                totalRevenue: db.orders.reduce((acc, o) => acc + (o.totalAmount || 0), 0),
                pendingOrders: db.orders.filter(o => o.status === 'pending').length,
                deliveredOrders: db.orders.filter(o => o.status === 'delivered').length,
                pendingShipments: db.shipments.filter(s => s.status === 'pending').length,
                pendingRmas: 2,
                riskCustomers: db.customers.filter(c => c.riskLevel === 'high').length,
                pendingCommissions: 5,
                overdueAmount: 150000
            },
            monthly: { orderCount: 45, revenue: 850000 },
            weekly: { orderCount: 12, revenue: 240000 },
            ordersByStatus: {
                pending: { count: 5, amount: 100000 },
                confirmed: { count: 8, amount: 200000 },
                shipped: { count: 3, amount: 50000 }
            },
            recentOrders: db.orders.slice(0, 5).map(o => ({
                 id: o.id,
                 orderNo: o.id,
                 customerName: o.customerName,
                 amount: o.totalAmount,
                 status: o.status,
                 createdAt: o.orderDate
             })),
            inventoryAlerts: [
                {
                    sku: 'HD-5000',
                    name: '聚乙烯 HD-5000',
                    stock: 80,
                    reorderPoint: 120,
                    pendingOrders: 3,
                    daysOfStock: 12,
                    priority: 'high',
                    suggestion: '库存低于补货点，建议补货 60 吨',
                },
                {
                    sku: 'PP-3000',
                    name: '聚丙烯 PP-3000',
                    stock: 150,
                    reorderPoint: 100,
                    pendingOrders: 1,
                    daysOfStock: 25,
                    priority: 'medium',
                    suggestion: '库存略低于安全线，建议关注近期订单波动'
                },
                {
                    sku: 'PVC-7000',
                    name: '聚氯乙烯 PVC-7000',
                    stock: 200,
                    reorderPoint: 180,
                    pendingOrders: 2,
                    daysOfStock: 30,
                    priority: 'low',
                    suggestion: '库存充足，可考虑降库优化周转'
                }
            ]
        };
    }

    if (path === '/dashboard/trends' && method === 'get') {
        return Array.from({ length: 12 }).map((_, i) => ({
            date: `2026-${String(i + 1).padStart(2, '0')}`,
            count: Math.floor(Math.random() * 50) + 10,
            amount: Math.floor(Math.random() * 500000) + 100000
        }));
    }

    // Default: return empty array for list endpoints, or success for others
    if (method === 'get') return [];
    return { success: true };
    };

    handleRequestImpl = handleRequest;
};

initMockData();

const handleRequest = async (config: AxiosRequestConfig): Promise<any> => {
    if (!handleRequestImpl) {
        initMockData();
    }
    return handleRequestImpl!(config);
};

// Axios Adapter
export const mockAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    await delay(300 + Math.random() * 500); // 300-800ms delay

    try {
        const responseData = await handleRequest(config);
        return {
            data: responseData,
            status: 200,
            statusText: 'OK',
            headers: {} as AxiosResponseHeaders,
            config,
            request: {}
        };
    } catch {
        return Promise.reject({
            config,
            response: {
                status: 500,
                data: { message: 'Mock Error' }
            }
        });
    }
};








