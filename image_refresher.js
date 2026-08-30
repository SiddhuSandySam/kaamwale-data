const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 HYBRID IMAGE REFRESHER & REPAIR (V182 - THE FINAL ULTIMATE)
 * Features: processAddressDiscovery (STRICT), Batch 10, FULL 31 COLUMNS, Target First.
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
        try { await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch }); doneBatch = []; } catch (e) {}
    }
}

// 🛡️ DO NOT DELETE THIS FUNCTION
function processAddressDiscovery(fullAddress, state) {
    try {
        if (!fullAddress || fullAddress === "N/A") return;
        const JUNK_KEYWORDS = ['building', 'shop', 'floor', 'plot', 'opp', 'near', 'room', 'flat', 'house', 'no', 'number', 'block', 'society', 'apt', 'apartment', 'tower', 'mandir', 'सेक्टर'];
        const addressParts = fullAddress.split(',').map(p => p.trim());
        let stateIdx = addressParts.length - 1;
        if (addressParts[stateIdx].toLowerCase() === "india" && addressParts.length >= 2) stateIdx--;
        for (let offset = 1; offset <= 4; offset++) {
            const idx = stateIdx - offset;
            if (idx < 0) break;
            const rawName = addressParts[idx].trim();
            if (rawName.includes('+') || rawName.length < 3) continue;
            const hasJunk = JUNK_KEYWORDS.some(k => rawName.toLowerCase().includes(k));
            if (!hasJunk) {
                const cleanName = rawName.replace(/[0-9]/g, '').trim();
                const isExisting = config.states.some(s => s.name.toLowerCase().includes(state.toLowerCase()) && s.cities.some(c => c.toLowerCase() === cleanName.toLowerCase()));
                if (!isExisting) {
                    const discoveryFile = path.join(__dirname, `discovered_W${WORKER_ID}.json`);
                    let discoveries = {};
                    if (fs.existsSync(discoveryFile)) { try { discoveries = JSON.parse(fs.readFileSync(discoveryFile)); } catch (e) {} }
                    const key = `${state}|${cleanName}`;
                    discoveries[key] = (discoveries[key] || 0) + 1;
                    fs.writeFileSync(discoveryFile, JSON.stringify(discoveries, null, 2));
                    writeLog(`   🏙️ DISCOVERED AREA: ${cleanName} in ${state}`);
                }
            }
        }
    } catch (e) {}
}

async function extractPortfolio(page) {
    try {
        await page.evaluate(async () => {
            const h1 = document.querySelector('h1.DUwDvf');
            const panel = h1 ? h1.closest('div[role="main"], div[role="dialog"]') : document.querySelector('div[role="main"]');
            if (panel) { for (let i = 0; i < 4; i++) { panel.scrollBy(0, 1000); await new Promise(r => setTimeout(r, 600)); } }
        });
        await page.waitForTimeout(1500);
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(img => {
                const src = img.src || '';
                if (src.includes('googleusercontent.com') && !src.includes('/a/') && !src.includes('base64')) {
                    let cleanUrl = src;
                    if (src.includes('=') && !src.includes('gps-cs-s')) { cleanUrl = src.split('=')[0].split('/s')[0] + '=w1000-h1000'; }
                    else if (src.includes('=s')) { cleanUrl = src.replace(/=s\d+/, '=s1000'); }
                    links.add(cleanUrl);
                }
            });
            return Array.from(links).filter(u => !u.includes('mapslogo')).slice(0, 20);
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

        const mapsPhoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
        const cleanMapsPhone = mapsPhoneStr.replace(/[^0-9]/g, '').slice(-10);
        writeLog(`   📱 Maps Phone: ${cleanMapsPhone} | Expected: ${dbPhone}`);
        const isMatch = (cleanMapsPhone !== "") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        const url = page.url();
        const pm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        let lat = pm ? parseFloat(pm[1]) : 0;
        let lon = pm ? parseFloat(pm[2]) : 0;

        const addrRaw = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanAddr = addrRaw.replace('\n', '').replace('', '').trim();
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
            city: task.city,
            locality: task.city,
            state: task.state,
            startingPrice: 0,
            priceUnit: "Discuss on Call",
            whatsappNumber: cleanMapsPhone,
            callNumber: cleanMapsPhone,
            aboutDescription: `Professional ${task.subcategory} services available in ${task.city}. High-quality work guaranteed by local experts.`,
            isApproved: true,
            isVerified: false,
            rating: 0.0,
            profilePhotoUrl: portfolio[0] ? portfolio[0].split('=')[0] + '=w500-h500-k-no' : "",
            recommendationCount: 0,
            portfolioUrls: portfolio,
            searchKeywords: [nameRaw, task.city, task.subcategory, task.state],
            lastSeen: Date.now(),
            callCount: 0,
            fullAddress: cleanAddr,
            isNumberHidden: false,
            referredBy: "V182_HARD_REPAIR",
            referralBonusPaid: false,
            fcmToken: "",
            notificationsEnabled: true,
            latitude: lat,
            longitude: lon
        };

        processAddressDiscovery(cleanAddr, task.state);
        syncBatch.push(provider);
        if (isMatch) summary.updated.push(`${nameRaw} (${dbPhone})`);
        else summary.discovered.push(`${nameRaw} (${cleanMapsPhone})`);
        return true;
    } catch (e) { return false; }
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

async function runWorker() {
    writeLog(`🚀 Hybrid Refresher V182 Starting (31 FIELD FULL SYNC)`);
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
        writeLog(`\n✅ UPDATED: ${summary.updated.length} | 🌟 DISCOVERED: ${summary.discovered.length}`);
    } catch (e) { writeLog(`🔥 Fatal Error: ${e.message}`); }
}
runWorker();
