const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const registry = require('./registry_manager');

/**
 * WORKER CONFIGURATION
 */
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const REFRESH_REGISTRY_FILE = path.join(__dirname, `refresh_registry_W${WORKER_ID}.json`);
const PROGRESS_FILE = path.join(__dirname, `progress_refresh_W${WORKER_ID}.json`);
const LOG_FILE = path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 50;

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    fs.appendFileSync(LOG_FILE, logMsg);
}

// Global Buffers
let sheetBuffer = [];
let stateUrls = {};
let refreshRegistry = {};
let progress = { stateIndex: 0, offset: 0 };

if (fs.existsSync(REFRESH_REGISTRY_FILE)) {
    try { refreshRegistry = JSON.parse(fs.readFileSync(REFRESH_REGISTRY_FILE)); } catch(e) {}
}

if (fs.existsSync(PROGRESS_FILE)) {
    try { progress = JSON.parse(fs.readFileSync(PROGRESS_FILE)); } catch(e) {}
}

function saveState() {
    fs.writeFileSync(REFRESH_REGISTRY_FILE, JSON.stringify(refreshRegistry, null, 2));
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function flushBuffer(stateName) {
    if (sheetBuffer.length === 0) return;
    const targetUrl = stateUrls[stateName] || HUB_URL;
    writeLog(`🚀 SYNCING BATCH: ${sheetBuffer.length} updates to [${stateName}]...`);
    try {
        const payload = { type: "BATCH_IMAGE_UPDATE", updates: sheetBuffer };
        const resp = await axios.post(targetUrl, payload, { timeout: 120000 });
        if (String(resp.data).includes("Success")) {
            writeLog(`✅ BATCH SUCCESS: ${sheetBuffer.length} records updated.`);
            sheetBuffer = [];
        } else {
            writeLog(`⚠️ SERVER BUSY: ${resp.data}. Retrying later...`);
        }
    } catch (e) {
        writeLog(`❌ SYNC ERROR: ${e.message}`);
    }
}

async function isBroken(url) {
    if (!url || !url.includes('googleusercontent.com')) return false;
    try {
        const resp = await axios.head(url, { timeout: 5000 });
        return resp.status !== 200;
    } catch (e) { return e.response && e.response.status === 403; }
}

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"]');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(3000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"]');
                if (gallery) { gallery.scrollBy(0, 1500); await new Promise(r => setTimeout(r, 400)); }
            });
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(img => {
                if (img.src && img.src.includes('googleusercontent.com') && !img.src.includes('/a/')) {
                    links.add(img.src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`🚀 Worker Starting | Partitions: ${WORKER_ID}/${TOTAL_WORKERS}`);
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        stateUrls = hubResp.data.stateUrls;
        const states = Object.keys(stateUrls);

        for (let sIdx = progress.stateIndex; sIdx < states.length; sIdx++) {
            const stateName = states[sIdx]; progress.stateIndex = sIdx;
            const stateUrl = stateUrls[stateName];
            writeLog(`\n🏙️ ENTERING STATE: ${stateName}`);

            let currentOffset = progress.offset;
            let limit = 500;

            while (true) {
                const resp = await axios.get(`${stateUrl}?type=providers&offset=${currentOffset}&limit=${limit}`);
                const providers = resp.data;
                if (!Array.isArray(providers) || providers.length === 0) break;

                for (let i = 0; i < providers.length; i++) {
                    // 🚀 MULTI-WORKER SHARDING
                    if ((currentOffset + i) % TOTAL_WORKERS !== WORKER_ID) continue;

                    const p = providers[i];
                    const dbPhone = String(p.id).replace('shadow_', '');
                    const lastRef = refreshRegistry[p.id] || 0;

                    if (Date.now() - lastRef > SEVEN_DAYS_MS && await isBroken(p.profilePhotoUrl)) {
                        writeLog(`🔍 REFRESH: ${p.businessName} (${dbPhone})`);
                        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(p.businessName + ", " + p.fullAddress)}`);
                        await page.waitForTimeout(4000);

                        const mapsPhone = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
                        const cleanMapsPhone = mapsPhone.replace(/[^0-9]/g, '').slice(-10);

                        if (cleanMapsPhone === dbPhone) {
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
                            writeLog(`⚠️ Skip: Phone mismatch (${cleanMapsPhone} vs ${dbPhone})`);
                        }
                        saveState();
                    }
                }
                currentOffset += limit;
                progress.offset = currentOffset;
                saveState();
            }
            await flushBuffer(stateName); // Final flush for state
            progress.offset = 0; // Reset offset for next state
        }
    } catch (e) { writeLog(`❌ FATAL: ${e.message}`); }
    finally { await browser.close(); writeLog("🏁 Worker Finished."); }
}

runWorker();
