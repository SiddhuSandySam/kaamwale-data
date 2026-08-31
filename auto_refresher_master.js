const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const REFRESH_REGISTRY_FILE = path.join(__dirname, 'refresh_registry_master.json');
const LOG_FILE = path.join(__dirname, 'refresh_logs.txt');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    fs.appendFileSync(LOG_FILE, logMsg);
}

// Load or Init Refresh Registry
let refreshRegistry = {};
if (fs.existsSync(REFRESH_REGISTRY_FILE)) {
    try { refreshRegistry = JSON.parse(fs.readFileSync(REFRESH_REGISTRY_FILE)); } catch(e) {}
}

function saveRegistry() {
    fs.writeFileSync(REFRESH_REGISTRY_FILE, JSON.stringify(refreshRegistry, null, 2));
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
        writeLog("   📸 Deep Scraping Portfolio (V198 - ANTI-PROFILE FIX)...");
        if (page.isClosed()) return [];

        // --- STEP 1: INITIAL SCAN & OPEN GALLERY ---
        const photoBtn = await page.$('button[data-value="Photos"], button[aria-label^="Photos"], .m67q60 button');
        let galleryOpened = false;

        if (photoBtn && await photoBtn.isVisible()) {
            writeLog("      ✅ Opening Photo Gallery Grid...");
            await photoBtn.click({ force: true });
            await page.waitForTimeout(5000);
            galleryOpened = true;
        }

        // --- STEP 2: TRY MAIN IMAGE IF TAB NOT FOUND ---
        if (!galleryOpened) {
            const mainImg = await page.$('button[aria-label^="Photo of"], img[src*="googleusercontent.com/p/"]');
            if (mainImg && await mainImg.isVisible()) {
                await mainImg.click({ force: true });
                await page.waitForTimeout(5000);
                galleryOpened = true;
            }
        }

        const allUrls = new Set();
        const loopCount = galleryOpened ? 20 : 8;

        for (let i = 0; i < loopCount; i++) {
            if (page.isClosed()) break;
            const batch = await page.evaluate((isGallery) => {
                const found = [];
                const container = isGallery ? (document.querySelector('.m6x62c-v77d8b-view-container, .DxyBCb, div[role="grid"]') || document.body) : document.body;

                const elements = container.querySelectorAll('img, div[style*="background-image"]');
                elements.forEach(el => {
                    let src = el.tagName === 'IMG' ? (el.src || el.getAttribute('src') || el.dataset.src) : "";
                    if (!src) {
                        const style = el.getAttribute('style') || "";
                        const match = style.match(/url\(["']?(.*?)["']?\)/);
                        if (match) src = match[1];
                    }

                    if (src && src.includes('googleusercontent.com') && !src.includes('base64')) {
                        // 🛡️ STRICT FILTERING
                        const isProfile = src.includes('/a/') || src.includes('/a-/') || src.includes('=s32') || src.includes('=s64');
                        const isPhoto = src.includes('/p/') || src.includes('/video/');

                        if (isProfile && !isPhoto) return;

                        let parent = el.parentElement;
                        let isReviewIcon = false;
                        for (let j = 0; j < 4; j++) {
                            if (!parent) break;
                            const aria = (parent.getAttribute('aria-label') || "").toLowerCase();
                            if (parent.tagName === 'BUTTON' && (parent.classList.contains('WEBjve') || aria.includes('review'))) {
                                isReviewIcon = true;
                                break;
                            }
                            parent = parent.parentElement;
                        }
                        if (isReviewIcon) return;

                        const clean = src.split('=')[0].split('/s')[0].split('/w')[0].split('/h')[0];
                        found.push(clean + '=s1000');
                    }
                });
                return found;
            }, galleryOpened);

            batch.forEach(url => allUrls.add(url));

            await page.evaluate((isGallery) => {
                const scrollable = isGallery ? document.querySelector('.m6x62c-v77d8b-view-container, .DxyBCb, div[role="grid"]') : null;
                if (scrollable) scrollable.scrollBy(0, 1200);
                else window.scrollBy(0, 1000);
            }, galleryOpened);
            await page.waitForTimeout(1000);
        }

        const portfolio = Array.from(allUrls).filter(u => !u.includes('mapslogo')).slice(0, 45);
        if (galleryOpened) {
            const backBtn = await page.$('button[aria-label="Back"], .VfPpkd-icon-LgbsSe, button[aria-label="Close"]');
            if (backBtn) { await backBtn.click(); await page.waitForTimeout(1000); }
        }

        writeLog(`   🖼️ Result: ${portfolio.length} images. First 2 URLs:`);
        portfolio.slice(0, 2).forEach((url, i) => writeLog(`      [${i+1}] ${url}`));

        return portfolio;
    } catch (e) { writeLog(`   ⚠️ Portfolio Error: ${e.message}`); return []; }
}

async function processState(stateName, stateUrl, browser) {
    writeLog(`\n================ STATE START: ${stateName} ================`);
    const page = await browser.newPage();
    let offset = 0;
    let limit = 200;
    let totalRefreshedInState = 0;

    while (true) {
        try {
            const resp = await axios.get(`${stateUrl}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 30000 });
            const providers = resp.data;
            if (!Array.isArray(providers) || providers.length === 0) break;

            writeLog(`Processing Batch: ${offset} - ${offset + limit} (${providers.length} records)`);

            for (let p of providers) {
                const lastRefresh = refreshRegistry[p.id] || 0;
                const needsRefresh = (Date.now() - lastRefresh > SEVEN_DAYS_MS);

                if (needsRefresh && await isBroken(p.profilePhotoUrl)) {
                    // Extract original phone from ID (e.g., shadow_8779666670 -> 8779666670)
                    const dbPhone = String(p.id).replace('shadow_', '').trim();

                    writeLog(`🔍 REFRESH NEEDED: [${p.businessName}] | Phone: ${dbPhone}`);

                    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(p.businessName + ", " + p.fullAddress)}`);
                    await page.waitForTimeout(4000);

                    // 🛡️ STRICT TITLE VERIFICATION
                    const mapsTitle = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "");
                    if (mapsTitle && !mapsTitle.toLowerCase().includes(p.businessName.toLowerCase().substring(0, 4)) &&
                        !p.businessName.toLowerCase().includes(mapsTitle.toLowerCase().substring(0, 4))) {
                        writeLog(`⚠️ SKIP: Title Mismatch. Maps: [${mapsTitle}] vs DB: [${p.businessName}]`);
                        continue;
                    }

                    // 🛡️ PHONE VERIFICATION: Extract phone from Google Maps
                    const mapsPhoneRaw = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
                    const cleanMapsPhone = mapsPhoneRaw.replace(/[^0-9]/g, '').slice(-10);

                    if (cleanMapsPhone !== dbPhone) {
                        writeLog(`⚠️ SKIP: Phone Mismatch. Maps: [${cleanMapsPhone}] vs DB: [${dbPhone}]`);
                        continue;
                    }

                    writeLog(`✅ PHONE MATCHED: ${dbPhone}. Proceeding with image extract...`);

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

                        try {
                            const hubRes = await axios.post(HUB_URL, payload);
                            const resMsg = String(hubRes.data);
                            if (resMsg.includes("Success") || resMsg.includes("config")) {
                                refreshRegistry[p.id] = Date.now();
                                saveRegistry();
                                totalRefreshedInState++;
                                writeLog(`🎉 UPDATED: ${p.businessName} | Images: ${portfolio.length}`);
                            } else {
                                const logMsg = resMsg.length > 100 ? resMsg.substring(0, 100) + "..." : resMsg;
                                writeLog(`❌ SERVER ERROR: ${p.businessName} | Msg: ${logMsg}`);
                            }
                        } catch (err) {
                            writeLog(`❌ HUB POST ERROR: ${p.businessName} | ${err.message}`);
                        }
                    } else {
                        writeLog(`⚠️ NO IMAGES: ${p.businessName} - No portfolio found.`);
                    }
                    await page.waitForTimeout(1000);
                }
            }
            offset += limit;
        } catch (e) {
            writeLog(`❌ BATCH ERROR at offset ${offset}: ${e.message}`);
            await new Promise(r => setTimeout(r, 5000));
            offset += limit;
        }
    }
    await page.close();
    writeLog(`\n================ STATE FINISHED: ${stateName} | Total: ${totalRefreshedInState} ================`);
}

async function main() {
    writeLog("🚀 GLOBAL REFRESH ENGINE STARTED (WITH PHONE VERIFICATION)");
    const browser = await chromium.launch({ headless: false });
    try {
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        const stateUrls = hubResp.data.stateUrls;

        for (let state of Object.keys(stateUrls)) {
            if (stateUrls[state]) {
                await processState(state, stateUrls[state], browser);
            }
        }
        writeLog("\n✅ ALL STATES COMPLETED SUCCESSFULLY");
    } catch (e) {
        writeLog(`❌ CRITICAL ERROR: ${e.message}`);
    }
    await browser.close();
}

main();
