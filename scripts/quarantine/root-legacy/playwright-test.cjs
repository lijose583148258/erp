const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
    let browser;
    try {
        console.log('Starting Playwright test...');
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        
        console.log('Navigating to app...');
        await page.goto('http://localhost:5001/');
        await page.waitForTimeout(1000); 
        
        console.log('Performing Login...');
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');

        console.log('Waiting for Dashboard...');
        // Layout.tsx has "爱劳达 ERP+CRM" text in the sidebar, so wait for it or dashboard elements
        await page.waitForSelector('text=爱劳达 ERP+CRM', { timeout: 10000 });
        console.log('Login successful.');
        
        console.log('Opening Procurement tab...');
        await page.click('text=采购管理');
        await page.waitForTimeout(2000);
        console.log('Checking Procurement Workspace...');
        const hasSuppliersTab = await page.evaluate(() => {
            return !!document.evaluate("//button[contains(., '供应商')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        });
        console.log('Found Suppliers Tab:', hasSuppliersTab);

        if (hasSuppliersTab) {
            console.log('Clicking Suppliers tab...');
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const btn = buttons.find(el => el.textContent.includes('供应商') && el.textContent.length < 10);
                if (btn) btn.click();
            });
            await page.waitForTimeout(2000);
            
            const tableText = await page.evaluate(() => document.body.innerText);
            console.log('Checking if default supplier is loaded...');
            const hasSupplier = tableText.includes('Demo') || tableText.includes('Sample') || tableText.includes('演示') || tableText.includes('Smoke') || tableText.includes('供应商 A');
            console.log('Suppliers Data Found:', hasSupplier);
            if (!hasSupplier) {
                console.log('Dump from UI:', tableText.substring(0, 3000));
            }
        }

        console.log('Opening Barter (货抵支付) module...');
        await page.evaluate(() => {
           const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('货抵支付'));
           if (btn) btn.click();
        });
        await page.waitForTimeout(2000);
        
        const barterText = await page.evaluate(() => document.body.innerText);
        console.log('Barter view loaded. Checking basic rendering...');
        console.log('Has Barter Mention:', barterText.includes('货抵') || barterText.includes('Barter'));
        
        console.log('Test completed successfully.');

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        if (browser) await browser.close();
    }
})();
