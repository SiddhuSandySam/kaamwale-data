const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 AUTO REFRESHER MULTI-WORKER (V178 - THE PERMANENT FIX)
 * Features: processAddressDiscovery (STRICT), Batch 10, Full Repair, Verbose Logs.
 */

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, 'config.json');

const summary = { updated: [], discovered: [], deactivated: [] };
let updateBatch = [];
let discoveryBatch = [];
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
    if (updateBatch.length > 0) {
        writeLog(`📤 Sending ${updateBatch.length} UPDATES...`);
        try { await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: updateBatch }); updateBatch = []; } catch (e) {}
    }
    if (discoveryBatch.length > 0) {
        writeLog(`🌟 Sending ${discoveryBatch.length} DISCOVERIES...`);
        try { await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: discoveryBatch }); discoveryBatch = []; } catch (e) {}
    }
    if (doneBatch.length > 0) {
        writeLog(`🧹 Cleaning ${doneBatch.length} items from Queue...`);
        try { await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch }); doneBatch = []; } catch (e) {}
    }
}

// 🛡️ DO NOT DELETE THIS FUNCTION
function processAddressDiscovery(fullAddress, state) {
    try {
        if (!fullAddress || fullAddress === "N/A") return;
        const JUNK_KEYWORDS = [
            'building', 'shop', 'floor', 'plot', 'opp', 'near', 'room', 'flat', 'house', 'no', 'number', 'block',
            'phase', 'lane', 'industrial', 'highway', 'road', 'rd', 'marg', 'st', 'station', 'bus stop', 'society',
            'apt', 'apartment', 'villa', 'tower', 'beside', 'behind', 'temple', 'hospital', 'school', 'church',
            'masjid', 'gate', 'mall', 'market', 'complex', 'center', 'centre', 'chowk', 'circle', 'bypass', 'yard',
            'ward', 'street', 'gali', 'sector', 'khasra', 'mandir', 'सेक्टर'
        ];
        const addressParts = fullAddress.split(',').map(p => p.trim());
        let stateIdx = addressParts.length - 1;
        if (addressParts[stateIdx].toLowerCase() === "india" && addressParts.length >= 2) stateIdx--;
        for (let offset = 1; offset <= 4; offset++) {
            const idx = stateIdx - offset;
            if (idx < 0) break;
            const rawName = addressParts[idx].trim();
            const nameLower = rawName.toLowerCase();
            const isPlusCode = rawName.includes('+');
            const isJunkCode = /^[0-9\-\/\&\s\.\#]+$/.test(rawName) || (rawName.length <= 5 && /[0-9]/.test(rawName));
            const hasJunkWords = JUNK_KEYWORDS.some(k => nameLower.includes(k));
            if (!isPlusCode && !isJunkCode && !hasJunkWords && rawName.length > 2) {
                const cleanName = rawName.replace(/[0-9]/g, '').replace(/[\+\#\-\/\&]/g, '').trim();
                if (cleanName.length < 3) continue;
                const isExisting = config.states.some(s => s.name.toLowerCase().includes(state.toLowerCase()) && s.cities.some(c => c.toLowerCase() === cleanName.toLowerCase()));
                if (!isExisting) {
                    const key = `${state}|${cleanName}`;
                    writeLog(`   🏙️ DISCOVERED AREA: ${cleanName} in ${state}`);
                    const discoveryFile = path.join(__dirname, `discovered_W${WORKER_ID}.json`);
                    let discoveries = {};
                    if (fs.existsSync(discoveryFile)) { try { discoveries = JSON.parse(fs.readFileSync(discoveryFile)); } catch (e) {} }
                    discoveries[key] = (discoveries[key] || 0) + 1;
                    fs.writeFileSync(discoveryFile, JSON.stringify(discoveries, null, 2));
                }
            }
        }
    } catch (e) {}
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
    writeLog(`🚀 Auto Refresher V178 Starting...`);
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
        writeLog("🏁 Finished.");
    } catch (e) { writeLog(`🔥 Fatal Error: ${e.message}`); }
}

async function processProfile(page, task, dbPhone, nameRaw) {
    try {
        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone.replace(/[^0-9]/g, '').slice(-10);
        writeLog(`   📱 Maps Phone: ${cleanMapsPhone} | Expected: ${dbPhone}`);
        if (cleanMapsPhone !== dbPhone) return false;

        const addrRaw = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanAddr = addrRaw.replace('\n', '').replace('', '').trim();
        processAddressDiscovery(cleanAddr, task.state); // 🚀 CALLING FOR MATCH

        const portfolio = await extractPortfolio(page);
        const url = page.url();
        const pm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        let lat = pm ? parseFloat(pm[1]) : 0;
        let lon = pm ? parseFloat(pm[2]) : 0;

        updateBatch.push({
            id: task.id, state: task.state, profilePhotoUrl: portfolio[0] || "", portfolioUrls: portfolio.join(','),
            primaryCategoryId: task.categoryId, subcategory: task.subcategory,
            latitude: lat, longitude: lon, city: task.city, locality: task.city,
            aboutDescription: `Professional ${task.subcategory} services in ${task.city}.`,
            lastSeen: Date.now()
        });
        writeLog(`   📦 Added to Batch (${updateBatch.length}/10)`);
        summary.updated.push(`${task.name} (${dbPhone})`);
        return true;
    } catch (e) { return false; }
}
runWorker();
