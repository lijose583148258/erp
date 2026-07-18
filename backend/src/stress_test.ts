
import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';

const prisma = new PrismaClient();
const API_URL = process.env.STRESS_TEST_API_URL || 'http://localhost:5001/api';

const requireCredential = (name: 'STRESS_TEST_USERNAME' | 'STRESS_TEST_PASSWORD') => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be provided explicitly.`);
    return value;
};

const requestJson = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
        ...init,
        signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => undefined);
    return { status: response.status, data };
};

// Configuration
const CONCURRENCY = 600;
const IMPORT_COUNT = 165295;
const EXPORT_COUNT = 235448;

async function main() {
    console.log('🚀 Starting Stress Test...');
    console.log(`Config: ${CONCURRENCY} concurrent users, ${IMPORT_COUNT} import, ${EXPORT_COUNT} export target.`);

    try {
        // 1. Data Generation (Import Simulation)
        console.log('\n--- Phase 1: Data Generation (Import) ---');
        const startImport = performance.now();

        // Check existing count
        const currentOrders = await prisma.order.count();
        const needed = IMPORT_COUNT; // We just add this many, regardless of current

        if (needed > 0) {
            console.log(`Generating ${needed} orders...`);
            const BATCH_SIZE = 1000;
            const batches = Math.ceil(needed / BATCH_SIZE);

            const customer = await prisma.customer.findFirst();
            const user = await prisma.user.findFirst();

            if (!customer || !user) {
                throw new Error('No customer or user found. Please seed basic data first.');
            }

            for (let i = 0; i < batches; i++) {
                const data = [];
                for (let j = 0; j < BATCH_SIZE; j++) {
                    if (i * BATCH_SIZE + j >= needed) break;
                    data.push({
                        orderNo: `ST-${Date.now()}-${i}-${j}-${Math.random()}`,
                        customerId: customer.id,
                        totalAmount: 100,
                        finalAmount: 100,
                        status: 'pending',
                        createdBy: user.id
                    });
                }
                // SQLite createMany is supported in recent versions, but check provider
                await prisma.order.createMany({ data });
                if (i % 10 === 0) process.stdout.write(`.`);
            }
        }
        const endImport = performance.now();
        console.log(`\n✅ Import completed in ${((endImport - startImport) / 1000).toFixed(2)}s`);


        // 2. Concurrency Query Test
        console.log('\n--- Phase 2: High Concurrency Test (600 users) ---');
        // Login to get token
        const loginRes = await requestJson('/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                username: requireCredential('STRESS_TEST_USERNAME'),
                password: requireCredential('STRESS_TEST_PASSWORD'),
            }),
        });
        if (loginRes.status !== 200 || !loginRes.data || typeof loginRes.data !== 'object') {
            throw new Error(`Stress-test login failed with status ${loginRes.status}.`);
        }
        const token = 'token' in loginRes.data && typeof loginRes.data.token === 'string'
            ? loginRes.data.token
            : undefined;
        if (!token) throw new Error('Stress-test login response did not contain a token.');

        const requests = [];
        for (let i = 0; i < CONCURRENCY; i++) {
            requests.push(
                requestJson('/dashboard/stats', {
                    headers: { Authorization: `Bearer ${token}` },
                }).catch(() => ({ status: 500, data: undefined }))
            );
        }

        const startReq = performance.now();
        const results = await Promise.all(requests);
        const endReq = performance.now();

        const success = results.filter((r: any) => r.status === 200 || r.data).length;
        console.log(`Wrapper: ${CONCURRENCY} requests processed.`);
        console.log(`Success: ${success}`);
        console.log(`Failed: ${CONCURRENCY - success}`);
        console.log(`Time: ${((endReq - startReq) / 1000).toFixed(2)}s`);
        console.log(`RPS: ${(CONCURRENCY / ((endReq - startReq) / 1000)).toFixed(2)}`);


        // 3. Export Simulation
        console.log('\n--- Phase 3: Export Simulation (235,448 records) ---');
        // Use prisma to fetch large dataset
        const startExport = performance.now();
        const records = await prisma.order.findMany({
            take: EXPORT_COUNT,
            select: { id: true, orderNo: true, totalAmount: true, status: true, createdAt: true }
        });
        const endExport = performance.now();
        console.log(`fetched ${records.length} records.`);
        console.log(`Export Query Time: ${((endExport - startExport) / 1000).toFixed(2)}s`);

    } catch (error) {
        console.error('Test Failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
