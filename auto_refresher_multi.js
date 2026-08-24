const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/**
 * WORKER CONFIGURATION
 */
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const REFRESH_REGISTRY_PREFIX = 'refresh_registry_W';
const MY_REGISTRY_FILE = path.join(__dirname, `${REFRESH_REGISTRY_PREFIX}${WORKER_ID}.json`);
const LOG_FILE = path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    fs.appendFileSync(LOG_FILE, logMsg);
}

// SHARED BRAIN: Load all worker registries to avoid double work
let sharedRefreshRegistry = {};
function loadSharedRegistry() {
    sharedRefreshRegistry = {};
    const files = fs.readdirSync(__dirname);
    files.forEach(file => {
        if (file.startsWith(REFRESH_REGISTRY_PREFIX) && file.endsWith('.json')) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(__dirname, file)));
                Object.assign(sharedRefreshRegistry, data);
            } catch (e) {}
        }
    });
}

function saveMyRegistry(id, timestamp) {
    let myData = {};
    if (fs.existsSync(MY_REGISTRY_FILE)) {
        try { myData = JSON.parse(fs.readFileSync(MY_REGISTRY_FILE)); } catch(e) {}
    }
    myData[id] = timestamp;
    sharedRefreshRegistry[id] = timestamp; // Update shared brain too
    fs.writeFileSync(MY_REGISTRY_FILE, JSON.stringify(myData, null, 2));
}

async function isBroken(url) {
    if (!url || !url.includes('googleusercontent.com')) return false;
    try {
        const resp = await axios.head(url, { timeout: 5000 });
        return resp.status !== 200;
    } catch (e) {
        return e.response && e.response.status === 403;
    }
}

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"]');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(3000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"]');
                if (gallery) { gallery.scrollBy(0, 2000); await new Promise(r => setTimeout(r, 500)); }
            });
        }
        return await page.evaluate(() => {
            const baseLinks = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    baseLinks.add(el.src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(baseLinks).map(base => `${base}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function processState(stateName, stateUrl, browser) {
    writeLog(`\n--- State Start: ${stateName} ---`);
    const page = await browser.newPage();
    let offset = 0;
    let limit = 500; // Larger batch for efficiency

    while (true) {
        try {
            const resp = await axios.get(`${stateUrl}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 60000 });
            const providers = resp.data;
            if (!Array.isArray(providers) || providers.length === 0) break;

            for (let i = 0; i < providers.length; i++) {
                // 🚀 PARTITIONING LOGIC: Each worker handles their assigned index
                if ((offset + i) % TOTAL_WORKERS !== WORKER_ID) continue;

                const p = providers[i];
                const lastRefresh = sharedRefreshRegistry[p.id] || 0;
                const needsRefresh = (Date.now() - lastRefresh > SEVEN_DAYS_MS);

                if (needsRefresh && await isBroken(p.profilePhotoUrl)) {
                    const dbPhone = String(p.id).replace('shadow_', '').trim();
                    writeLog(`Checking: [${p.businessName}] | ID: ${p.id}`);

                    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(p.businessName + ", " + p.fullAddress)}`, { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(4000);

                    const mapsPhoneRaw = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
                    const cleanMapsPhone = mapsPhoneRaw.replace(/[^0-9]/g, '').slice(-10);

                    if (cleanMapsPhone === dbPhone) {
                        writeLog(`✅ Phone Match: ${dbPhone}. Extracting images...`);
                        let portfolio = await extractPortfolio(page);
                        if (portfolio.length > 0) {
                            const payload = {
                                type: "BATCH_IMAGE_UPDATE",
                                state: stateName,
                                updates: [{
                                    id: String(p.id),
                                    profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                                    portfolioUrls: portfolio.join(',')
                                }]
                            };
                            const hubRes = await axios.post(HUB_URL, payload);
                            if (String(hubRes.data).includes("Success")) {
                                saveMyRegistry(p.id, Date.now());
                                writeLog(`🎉 SUCCESS: ${p.businessName} updated.`);
                            }
                        }
                    } else {
                        writeLog(`⚠️ Skip: Phone mismatch (${cleanMapsPhone} vs ${dbPhone})`);
                    }
                }
            }
            offset += limit;
        } catch (e) {
            writeLog(`Batch Error: ${e.message}`);
            offset += limit;
        }
    }
    await page.close();
}

async function main() {
    writeLog(`🚀 Worker ${WORKER_ID}/${TOTAL_WORKERS} Started.`);
    loadSharedRegistry();

    // GitHub Actions वर चालताना headless: true वापरणे गरजेचे आहे
    const isHeadless = process.env.HEADLESS_OVERRIDE === "true";
    const browser = await chromium.launch({
        headless: isHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        const stateUrls = hubResp.data.stateUrls;
        const states = Object.keys(stateUrls);

        for (let state of states) {
            await processState(state, stateUrls[state], browser);
        }
    } catch (e) { writeLog(`Fatal: ${e.message}`); }
    await browser.close();
}

main();
