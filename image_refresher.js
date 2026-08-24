const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * REFRESHER CONFIGURATION (V99 - MONTHLY AUTO-RESET ENGINE)
 */
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;
const TARGET_STATE_FILTER = args[2] || "";

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const REFRESH_REGISTRY_FILE = path.join(__dirname, `refresher_registry_W${WORKER_ID}.json`);
const PROGRESS_FILE = path.join(__dirname, `refresher_progress_W${WORKER_ID}.json`);
const LOG_FILE = path.join(__dirname, `refresher_logs_W${WORKER_ID}.txt`);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 50;

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    fs.appendFileSync(LOG_FILE, logMsg);
}

let sheetBuffer = [];
let stateUrls = {};
let refreshRegistry = {};
let progress = { stateIndex: 0, offset: 0, lastResetMonth: new Date().getMonth() };

// 🚀 MONTHLY RESET LOGIC
function checkAndReset() {
    const currentMonth = new Date().getMonth();
    if (progress.lastResetMonth !== currentMonth) {
        writeLog(`🚨 [RESET] New month detected! Resetting progress and registry...`);
        progress = { stateIndex: 0, offset: 0, lastResetMonth: currentMonth };
        refreshRegistry = {};
        saveState();
    }
}

// Load Existing Data
if (fs.existsSync(REFRESH_REGISTRY_FILE)) {
    try { refreshRegistry = JSON.parse(fs.readFileSync(REFRESH_REGISTRY_FILE)); } catch(e) {}
}
if (fs.existsSync(PROGRESS_FILE)) {
    try { progress = JSON.parse(fs.readFileSync(PROGRESS_FILE)); } catch(e) {}
}

checkAndReset(); // Initial check

function saveState() {
    fs.writeFileSync(REFRESH_REGISTRY_FILE, JSON.stringify(refreshRegistry, null, 2));
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function flushBuffer(stateName) {
    if (sheetBuffer.length === 0) return;
    const targetUrl = stateUrls[stateName] || HUB_URL;
    let success = false;
    while (!success) {
        writeLog(`🚀 [SYNC] Sending batch of ${sheetBuffer.length} to [${stateName}]...`);
        try {
            // 🛡️ ONLY TARGET PHOTO FIELDS - NO OTHER DATA IMPACTED
            const payload = { type: "BATCH_IMAGE_UPDATE", state: stateName, updates: sheetBuffer };
            const resp = await axios.post(targetUrl, payload, { timeout: 120000 });
            if (String(resp.data).includes("Success")) {
                writeLog(`✅ [SUCCESS] Batch sync completed.`);
                sheetBuffer = [];
                success = true;
            } else {
                writeLog(`🔄 [RETRY] Server Busy. Retrying in 20s...`);
                await new Promise(r => setTimeout(r, 20000));
            }
        } catch (e) {
            writeLog(`🔄 [RETRY] Network Error: ${e.message}. Retrying in 40s...`);
            await new Promise(r => setTimeout(r, 40000));
        }
    }
}

async function isBroken(url) {
    if (!url || !url.includes('googleusercontent.com')) return false;
    try {
        const resp = await axios.head(url, { timeout: 8000 });
        return resp.status !== 200;
    } catch (e) { return e.response && e.response.status === 403; }
}

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(4000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) { for (let i = 0; i < 5; i++) { gallery.scrollBy(0, 1500); await new Promise(r => setTimeout(r, 500)); } }
            });
            await page.waitForTimeout(2000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img, div[style*="background-image"]').forEach(el => {
                let src = el.tagName === 'IMG' ? el.src : (el.style.backgroundImage.match(/url\(["']?([^"']+)["']?\)/) || [])[1];
                if (src && src.includes('googleusercontent.com') && !src.includes('/a/')) {
                    links.add(src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`\n===============================================`);
    writeLog(`🚀 RAPIDHELP REFRESHER | Worker: ${WORKER_ID}/${TOTAL_WORKERS}`);
    writeLog(`===============================================\n`);

    const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    try {
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        stateUrls = hubResp.data.stateUrls;
        const states = Object.keys(stateUrls);

        for (let sIdx = progress.stateIndex; sIdx < states.length; sIdx++) {
            const stateName = states[sIdx];
            if (TARGET_STATE_FILTER && stateName !== TARGET_STATE_FILTER) continue;

            const stateUrl = stateUrls[stateName];
            writeLog(`\n🏙️ [STATE START] Processing: ${stateName}`);

            let currentOffset = (sIdx === progress.stateIndex) ? progress.offset : 0;
            let limit = 500;

            while (true) {
                const resp = await axios.get(`${stateUrl}?type=providers&offset=${currentOffset}&limit=${limit}`).catch(() => ({ data: [] }));
                const providers = resp.data;
                if (!Array.isArray(providers) || providers.length === 0) break;

                for (let i = 0; i < providers.length; i++) {
                    if ((currentOffset + i) % TOTAL_WORKERS !== WORKER_ID) continue;

                    const p = providers[i];
                    const dbPhone = String(p.id).replace('shadow_', '');
                    const lastRef = refreshRegistry[p.id] || 0;

                    // CHECK COOLDOWN AND BROKEN STATUS
                    if (Date.now() - lastRef > SEVEN_DAYS_MS && await isBroken(p.profilePhotoUrl)) {
                        writeLog(`🔍 [SCAN] ${p.businessName} (${dbPhone})`);

                        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(p.businessName + ", " + p.fullAddress)}`, { timeout: 60000 });
                        await page.waitForTimeout(4000);

                        const mapsPhoneRaw = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
                        const cleanMapsPhone = mapsPhoneRaw.replace(/[^0-9]/g, '').slice(-10);

                        if (cleanMapsPhone === dbPhone) {
                            writeLog(`✅ [MATCH] Extracting for ${p.businessName}...`);
                            let portfolio = await extractPortfolio(page);
                            if (portfolio.length > 0) {
                                sheetBuffer.push({
                                    id: String(p.id),
                                    profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                                    portfolioUrls: portfolio.join(',')
                                });
                                refreshRegistry[p.id] = Date.now();
                                if (sheetBuffer.length >= BATCH_LIMIT) await flushBuffer(stateName);
                            }
                        } else {
                            writeLog(`⚠️ [SKIP] Phone Mismatch: Maps[${cleanMapsPhone}] vs DB[${dbPhone}]`);
                        }
                        saveState();
                    }
                }
                currentOffset += limit;
                progress.stateIndex = sIdx;
                progress.offset = currentOffset;
                saveState();
            }
            await flushBuffer(stateName);
            progress.offset = 0;
            saveState();
        }
    } catch (e) { writeLog(`❌ [FATAL] Critical Error: ${e.message}`); }
    finally { await browser.close(); writeLog("🏁 [FINISHED] All states done for this month."); }
}

runWorker();
