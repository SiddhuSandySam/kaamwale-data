const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 AUTO REFRESHER MULTI-WORKER (V173 - MAXIMUM LOGGING EDITION)
 * Features: Batch 10, Address Discovery, Full Repair, Verbose Logs.
 */

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const summary = { updated: [], discovered: [], deactivated: [] };
let updateBatch = [];
let discoveryBatch = [];
let doneBatch = [];

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[W${WORKER_ID}] [${timestamp}] ${msg}`);
    fs.appendFileSync(path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`), `[${timestamp}] ${msg}\n`);
}

async function flushBatches() {
    writeLog("⚡ STARTING BATCH FLUSH...");
    if (updateBatch.length > 0) {
        writeLog(`📤 Sending ${updateBatch.length} UPDATES...`);
        try {
            const r = await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: updateBatch });
            writeLog(`   ✅ Hub Update Response: ${JSON.stringify(r.data)}`);
            updateBatch = [];
        } catch (e) { writeLog(`   ❌ Update Flush Error: ${e.message}`); }
    }
    if (discoveryBatch.length > 0) {
        writeLog(`🌟 Sending ${discoveryBatch.length} DISCOVERIES...`);
        try {
            const r = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: discoveryBatch });
            writeLog(`   ✅ Hub Discovery Response: ${JSON.stringify(r.data)}`);
            discoveryBatch = [];
        } catch (e) { writeLog(`   ❌ Discovery Flush Error: ${e.message}`); }
    }
    if (doneBatch.length > 0) {
        writeLog(`🧹 Cleaning ${doneBatch.length} items from Queue...`);
        try {
            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch });
            doneBatch = [];
        } catch (e) {}
    }
    writeLog("⚡ BATCH FLUSH COMPLETED.");
}

async function extractPhone(page) {
    const selectors = ['button[data-item-id^="phone"]', 'button[aria-label*="Phone"]', 'a[href^="tel:"]'];
    for (let sel of selectors) {
        try {
            const text = await page.$eval(sel, el => el.innerText || el.getAttribute('aria-label') || el.getAttribute('href') || "");
            const clean = text.replace(/[^0-9]/g, '');
            if (clean.length >= 8) return clean;
        } catch (e) {}
    }
    return "NOT_FOUND";
}

async function extractPortfolio(page) {
    try {
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"]');
        if (photoBtn) {
            await photoBtn.click({ force: true });
            await page.waitForTimeout(5000);
            for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(800); }
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src?.includes('googleusercontent.com')) links.add(el.src.split('=')[0] + '=s1000');
            });
            return Array.from(links).slice(0, 20);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`🚀 Auto Refresher V173 Starting... (Worker: ${WORKER_ID})`);
    try {
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];
        if (allTasks.length === 0) return writeLog("✅ Queue Empty.");
        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);

        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        for (const task of myTasks) {
            if (!task.city || !task.categoryId || !task.subcategory) { doneBatch.push(task.id); continue; }
            const dbPhone = String(task.id).replace('shadow_', '');
            const searchQuery = `${task.subcategory} in ${task.city}, ${task.state}`;

            writeLog(`\n━━━━━━━━━━━━━━ TASK: ${task.name} ━━━━━━━━━━━━━━`);
            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`);
                await page.waitForTimeout(5000);
                const status = await Promise.race([
                    page.waitForSelector('a.hfpxzc', { timeout: 15000 }).then(() => "LIST").catch(() => null),
                    page.waitForSelector('h1.DUwDvf', { timeout: 15000 }).then(() => "SINGLE").catch(() => null)
                ]);

                if (status === "SINGLE") {
                    const name = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "Unknown");
                    await processProfile(page, task, dbPhone, name);
                } else if (status === "LIST") {
                    const listings = await page.$$('a.hfpxzc');
                    for (let i = 0; i < Math.min(listings.length, 5); i++) {
                        const items = await page.$$('a.hfpxzc');
                        if (!items[i]) break;
                        await items[i].click();
                        await page.waitForTimeout(3000);
                        if (await processProfile(page, task, dbPhone, "Unknown")) break;
                        const back = await page.$('button[aria-label*="Back"]');
                        if (back) { await back.click(); await page.waitForTimeout(1500); }
                    }
                }
                doneBatch.push(task.id);
                if (doneBatch.length >= 10) await flushBatches();
            } catch (err) { writeLog(`❌ Task Error: ${err.message}`); }
        }
        await flushBatches();
        await browser.close();
        writeLog("🏁 Auto Refresher Finished.");
    } catch (e) { writeLog(`🔥 Fatal Error: ${e.message}`); }
}

async function processProfile(page, task, dbPhone, nameRaw) {
    try {
        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone.replace(/[^0-9]/g, '').slice(-10);
        writeLog(`   📱 Maps Phone: ${cleanMapsPhone} | Expected: ${dbPhone}`);
        if (cleanMapsPhone !== dbPhone) return false;

        const portfolio = await extractPortfolio(page);
        const url = page.url();
        const pm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        let lat = pm ? parseFloat(pm[1]) : 0;
        let lon = pm ? parseFloat(pm[2]) : 0;

        updateBatch.push({
            id: task.id, state: task.state, profilePhotoUrl: portfolio[0] || "", portfolioUrls: portfolio.join(','),
            primaryCategoryId: task.categoryId, subcategory: task.subcategory,
            latitude: lat, longitude: lon, city: task.city, locality: task.city,
            aboutDescription: `Professional ${task.subcategory} services in ${task.city}.`
        });
        writeLog(`   📦 Added to Batch (${updateBatch.length}/10)`);
        summary.updated.push(`${task.name} (${dbPhone})`);
        return true;
    } catch (e) { return false; }
}
runWorker();
