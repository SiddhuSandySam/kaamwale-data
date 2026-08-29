const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 HYBRID IMAGE REFRESHER & REPAIR (V175 - MULTI-WORKER STYLE)
 * Purpose: Full 31-column Sync/Repair in Batches of 10.
 */

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, 'config.json');

const summary = { updated: [], discovered: [], deactivated: [] };
let syncBatch = [];
let doneBatch = [];

let config = { states: [] };
if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch (e) {}
}

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[W${WORKER_ID}] [${timestamp}] ${msg}`);
    fs.appendFileSync(path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`), `[${timestamp}] ${msg}\n`);
}

async function flushBatches() {
    if (syncBatch.length > 0) {
        writeLog(`📤 Syncing ${syncBatch.length} leads to Sheet (Full 31-Column Mode)...`);
        try {
            const r = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: syncBatch });
            writeLog(`   ✅ Hub Response: ${JSON.stringify(r.data)}`);
            syncBatch = [];
        } catch (e) { writeLog(`   ❌ Sync Error: ${e.message}`); }
    }
    if (doneBatch.length > 0) {
        writeLog(`🧹 Cleaning ${doneBatch.length} items from Queue...`);
        try {
            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch });
            doneBatch = [];
        } catch (e) {}
    }
}

function processAddressDiscovery(fullAddress, state) {
    try {
        const parts = fullAddress.split(',').map(p => p.trim());
        const JUNK = ['building', 'shop', 'floor', 'plot', 'near', 'road', 'sector', 'street'];
        for (let i = 0; i < Math.min(parts.length, 5); i++) {
            const raw = parts[i];
            const lower = raw.toLowerCase();
            if (raw.includes('+') || JUNK.some(k => lower.includes(k)) || raw.length < 3) continue;
            const clean = raw.replace(/[0-9]/g, '').trim();
            if (clean.length < 3) continue;
            const isExisting = config.states.some(s => s.name.toLowerCase().includes(state.toLowerCase()) && s.cities.some(c => c.toLowerCase() === clean.toLowerCase()));
            if (!isExisting) {
                const discoveryFile = path.join(__dirname, `discovered_W${WORKER_ID}.json`);
                let discoveries = {};
                if (fs.existsSync(discoveryFile)) { try { discoveries = JSON.parse(fs.readFileSync(discoveryFile)); } catch (e) {} }
                const key = `${state}|${clean}`;
                discoveries[key] = (discoveries[key] || 0) + 1;
                fs.writeFileSync(discoveryFile, JSON.stringify(discoveries, null, 2));
            }
        }
    } catch (e) {}
}

async function extractPhone(page) {
    const selectors = ['button[data-item-id^="phone"]', 'button[aria-label*="Phone"]', '.CsEnBe[aria-label*="Phone"]', 'a[href^="tel:"]'];
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
        await page.evaluate(async () => {
            const panel = document.querySelector('div[role="main"], div[role="dialog"]');
            if (panel) { panel.scrollBy(0, 600); await new Promise(r => setTimeout(r, 400)); }
        });
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
            await photoBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(5000);
            for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(800); }
            await page.waitForTimeout(2000);
        }
        return await page.evaluate(() => {
            const set = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    set.add(el.src.split('=')[0].split('/s')[0] + '=s1000');
                }
            });
            return Array.from(set).slice(0, 25);
        });
    } catch (e) { return []; }
}

async function processProfile(page, task, dbPhone, nameRaw) {
    try {
        const isClosed = await page.evaluate(() => document.body.innerText.toLowerCase().includes('temporarily closed'));
        if (isClosed && nameRaw.toLowerCase().includes(task.name.toLowerCase().substring(0,3))) {
            writeLog(`   🚫 DEACTIVATING: ${nameRaw} is Closed.`);
            summary.deactivated.push(`${nameRaw} (${dbPhone})`);
            await axios.post(HUB_URL, { type: "DELETE_ENTRIES", id: task.id });
            return true;
        }

        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
        const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        const url = page.url();
        let lat = 0, lon = 0;
        const pm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        const fm = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (pm) { lat = parseFloat(pm[1]); lon = parseFloat(pm[2]); }
        else if (fm) { lat = parseFloat(fm[1]); lon = parseFloat(fm[2]); }

        const addrRaw = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanAddr = addrRaw.replace('\n', '').replace('', '').trim();

        // 🚀 STRICT N/A SKIP
        if (cleanAddr === "N/A" || !cleanAddr) return false;

        const portfolio = await extractPortfolio(page);
        if (portfolio.length === 0) return false;

        const provider = {
            id: isMatch ? task.id : `shadow_${cleanMapsPhone}`,
            businessName: nameRaw,
            primaryCategoryId: task.categoryId,
            subcategory: task.subcategory,
            experienceYears: Math.floor(Math.random() * 5) + 3,
            serviceMode: "Local",
            city: task.city, locality: task.city, state: task.state,
            startingPrice: 0, priceUnit: "Discuss on Call",
            whatsappNumber: cleanMapsPhone, callNumber: cleanMapsPhone,
            aboutDescription: `Professional ${task.subcategory} services available in ${task.city}. High-quality work guaranteed by local experts.`,
            isApproved: true, isVerified: false, rating: 0.0,
            profilePhotoUrl: portfolio[0] ? portfolio[0].split('=')[0] + '=w500-h500-k-no' : "",
            recommendationCount: 0, portfolioUrls: portfolio,
            searchKeywords: [nameRaw, task.city, task.subcategory],
            lastSeen: Date.now(), callCount: 0, fullAddress: cleanAddr,
            isNumberHidden: false, referredBy: "REPAIR_ENGINE_V175",
            latitude: lat, longitude: lon
        };

        syncBatch.push(provider);
        if (isMatch) summary.updated.push(`${nameRaw} (${dbPhone})`);
        else summary.discovered.push(`${nameRaw} (${cleanMapsPhone})`);

        return true;
    } catch (e) { return false; }
}

async function runWorker() {
    writeLog(`🚀 Hybrid Refresher V175 Starting (Headless: FALSE)`);
    try {
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];
        if (allTasks.length === 0) return writeLog("✅ Queue Empty.");
        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);

        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();

        for (const task of myTasks) {
            if (!task.city || !task.categoryId || !task.subcategory) { doneBatch.push(task.id); continue; }
            const dbPhone = String(task.id).replace('shadow_', '');
            const searchQuery = `${task.name}, ${task.city}, ${task.state}`;

            writeLog(`\n━━━━━━━━━━━━━━ TASK: ${task.name} ━━━━━━━━━━━━━━`);
            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`, { timeout: 60000 });
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
                        const nameRaw = await items[i].getAttribute('aria-label').catch(() => "Unknown");
                        await items[i].click({ force: true });
                        await page.waitForTimeout(3000);
                        if (await processProfile(page, task, dbPhone, nameRaw)) break;
                        const back = await page.$('button[aria-label*="Back"]');
                        if (back) { await back.click(); await page.waitForTimeout(1500); }
                    }
                }
                doneBatch.push(task.id);
                if (syncBatch.length >= 10 || doneBatch.length >= 10) await flushBatches();
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }
        await flushBatches();
        await browser.close();
        writeLog(`\n✅ UPDATED: ${summary.updated.length} | 🌟 DISCOVERED: ${summary.discovered.length} | 🚫 DEACTIVATED: ${summary.deactivated.length}`);
    } catch (e) { writeLog(`🔥 Fatal Error: ${e.message}`); }
}
runWorker();
