const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const registry = require('./registry_manager');

/**
 * WORKER CONFIGURATION
 */
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const MAIN_HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const SYNC_FIRESTORE_ENABLED = true;
const SYNC_SHEET_ENABLED = true;
const HEADLESS = false; 
const COOL_DOWN_MS = 1000;

// FILE PATHS
const CONFIG_FILE = path.join(__dirname, 'config.json');
const REGISTRY_FILE = path.join(__dirname, 'master_registry.json');
const PROGRESS_FILE = path.join(__dirname, `progress_W${WORKER_ID}.json`);
const FAILED_SYNC_FILE = path.join(__dirname, `failed_sync_W${WORKER_ID}.json`);
const BACKUP_LEADS_FILE = path.join(__dirname, `backup_leads_W${WORKER_ID}.json`);
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');

// --- STARTUP HEADER ---
console.log("\n===============================================");
console.log(`   RAPIDHELP WORKER ${WORKER_ID} | VERSION: V52 | SMART-DETECT`);
console.log("===============================================\n");

// INITIALIZE FIREBASE
let db;
if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE));
    if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
    console.log(`Worker ${WORKER_ID} | INFO | Firebase Initialized.`);
}

// GLOBAL STATE
let config = JSON.parse(fs.readFileSync(CONFIG_FILE));
let stateUrls = {};
let currentTargetUrl = MAIN_HUB_URL;
let lastFullSyncTime = 0;

// Initialize SQLite registry
registry.migrateFromJson();

let progress = { stateIndex: 0, cityIndex: 0, categoryIndex: 0, subcategoryIndex: 0, lastRegistrySync: 0 };

async function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        progress = JSON.parse(fs.readFileSync(PROGRESS_FILE));
    }
    if (db) {
        try {
            const doc = await db.collection('metadata').doc(`progress_W${WORKER_ID}`).get();
            if (doc.exists) progress = doc.data();
        } catch (e) {}
    }
}

let sheetBuffer = [];
let firestoreBuffer = [];
let isFlushing = false;
let newLeadsCount = 0;
const BATCH_LIMIT = 50;

async function saveProgress() {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    if (db) {
        await db.collection('metadata').doc(`progress_W${WORKER_ID}`).set(progress).catch(() => {});
    }
}

async function flushBuffers() {
    if (isFlushing) return;
    isFlushing = true;
    try {
        if (firestoreBuffer.length > 0 && db) {
            const batch = db.batch();
            firestoreBuffer.forEach(p => {
                batch.set(db.collection('providers').doc(p.id), p, { merge: true });
            });
            await batch.commit();
            firestoreBuffer = [];
            console.log(`Worker ${WORKER_ID} | SYNC | Firestore: Success.`);
        }
        if (sheetBuffer.length > 0) {
            const resp = await axios.post(currentTargetUrl, { type: "BATCH_PROVIDER_SYNC", providers: sheetBuffer }, { timeout: 60000 });
            console.log(`Worker ${WORKER_ID} | SYNC | Sheet: Success 🚀`);
            sheetBuffer = [];
        }
    } catch (e) {
        console.error(`Worker ${WORKER_ID} | SYNC | Error: ${e.message}`);
    } finally {
        isFlushing = false;
    }
}

async function syncFromSatellite(targetUrl) {
    if (!targetUrl) return;
    let cleanUrl = targetUrl.trim().split('?')[0];
    try {
        const response = await axios.get(`${cleanUrl}?type=get_ids`, { timeout: 90000 });
        if (Array.isArray(response.data)) {
            registry.addBatch(response.data);
            lastFullSyncTime = Date.now();
        }
    } catch (e) {}
}

let isStopping = false;
async function gracefulShutdown(isError = false) {
    if (isStopping) return;
    isStopping = true;
    console.log(`\nWorker ${WORKER_ID} | [EXIT] | Shutting down...`);
    await flushBuffers();
    process.exit(isError ? 1 : 0);
}

process.on('SIGINT', () => gracefulShutdown(false));

async function scrapeIndividualProfile(page, businessName, city, state, categoryId, subcategory) {
    try {
        const phoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
        const cleanPhone = phoneStr.replace(/[^0-9]/g, '').slice(-10);

        if (!cleanPhone || cleanPhone.length < 10 || registry.has(cleanPhone)) return 0;

        const fullAddress = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const urlCoords = page.url().match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

        const provider = {
            id: `shadow_${cleanPhone}`,
            businessName: businessName,
            primaryCategoryId: categoryId,
            subcategory: subcategory,
            experienceYears: Math.floor(Math.random() * 5) + 1,
            city: city, state: state,
            fullAddress: fullAddress.replace('', '').trim(),
            whatsappNumber: cleanPhone,
            callNumber: cleanPhone,
            lastSeen: Date.now(),
            latitude: urlCoords ? parseFloat(urlCoords[1]) : 0,
            longitude: urlCoords ? parseFloat(urlCoords[2]) : 0,
            isApproved: true,
            isVerified: false,
            rating: 0.0,
            referredBy: "SYSTEM_SCRAPER"
        };

        sheetBuffer.push(provider);
        firestoreBuffer.push(provider);
        registry.add(cleanPhone);
        newLeadsCount++;
        console.log(`Worker ${WORKER_ID} | [+] | Found: ${businessName} (Total New: ${newLeadsCount})`);

        if (sheetBuffer.length >= BATCH_LIMIT) await flushBuffers();
        return 1;
    } catch (err) { return 0; }
}

async function scrapeCombination(page, city, state, categoryId, subcategory) {
    if (isStopping) return 0;
    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(subcategory + " in " + city + ", " + state)}`);

        // Handle Google Consent Dialog
        const consentBtn = await page.$('button[aria-label="Accept all"]').catch(() => null);
        if (consentBtn) await consentBtn.click();

        // 🚀 SMART RACE: Detect List, Single Profile, or Empty results
        const status = await Promise.race([
            page.waitForSelector('a.hfpxzc', { timeout: 60000 }).then(() => "LIST"),
            page.waitForSelector('h1.DUwDvf', { timeout: 20000 }).then(() => "SINGLE"),
            page.waitForSelector('div.fvP2If, div.H6v83d', { timeout: 15000 }).then(() => "EMPTY"),
            page.waitForTimeout(55000).then(() => "TIMEOUT")
        ]);

        if (status === "EMPTY" || status === "TIMEOUT") {
            console.log(`Worker ${WORKER_ID} | [-] | No data found for ${subcategory} in ${city}.`);
            return 0;
        }

        if (status === "SINGLE") {
            console.log(`Worker ${WORKER_ID} | [!] | Direct Profile Page detected in ${city}.`);
            const name = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "Unknown");
            return await scrapeIndividualProfile(page, name, city, state, categoryId, subcategory);
        }

        // --- List Scraping Logic ---
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2000);

        const listings = await page.$$('a.hfpxzc');
        let streak = 0;
        let foundCount = 0;

        for (let i = 0; i < Math.min(listings.length, 30); i++) {
            if (isStopping) break;
            const listing = listings[i];
            const nameRaw = await listing.getAttribute('aria-label');

            await listing.scrollIntoViewIfNeeded();
            await listing.click();

            let updated = false;
            for (let r = 0; r < 10; r++) {
                const title = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "");
                if (title.toLowerCase().includes(nameRaw.toLowerCase().substring(0, 4))) {
                    updated = true; break;
                }
                await page.waitForTimeout(1000);
            }
            if (!updated) continue;

            const res = await scrapeIndividualProfile(page, nameRaw, city, state, categoryId, subcategory);
            if (res === 1) { foundCount++; streak = 0; }
            else {
                streak++;
                if (streak >= 4) {
                    console.log(`Worker ${WORKER_ID} | [🛑] | Streak hit. Next category...`);
                    return foundCount;
                }
            }
        }
        return foundCount;
    } catch (e) {
        console.error(`Worker ${WORKER_ID} | [FATAL] | Scrape Error: ${e.message}`);
        return -1;
    }
}

async function runOrchestrator() {
    await loadProgress();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    try {
        // 🚀 FETCH HUB CONFIG (Crucial for routing)
        console.log(`Worker ${WORKER_ID} | INFO | Fetching Routing Table from Hub...`);
        const hubResp = await axios.get(`${MAIN_HUB_URL}?type=config`, { timeout: 30000 });
        if (hubResp.data && hubResp.data.stateUrls) {
            stateUrls = hubResp.data.stateUrls;
            console.log(`Worker ${WORKER_ID} | INFO | Hub Loaded. Active States: ${Object.keys(stateUrls).join(', ')}`);
        }
        for (let sIdx = progress.stateIndex; sIdx < config.states.length; sIdx++) {
            const state = config.states[sIdx]; progress.stateIndex = sIdx;
            currentTargetUrl = stateUrls[state.name];
            if (!currentTargetUrl) continue;

            if (sheetBuffer.length > 0 || firestoreBuffer.length > 0) {
                console.log(`Worker ${WORKER_ID} | INFO | Flushing leads before switching to ${state.name}...`);
                await flushBuffers();
            }

            await syncFromSatellite(currentTargetUrl);

            let cities = [...state.cities]; if (WORKER_ID % 2 === 0) cities.reverse();

            for (let catIdx = progress.categoryIndex; catIdx < config.categories.length; catIdx++) {
                if (catIdx % TOTAL_WORKERS !== WORKER_ID) {
                    progress.cityIndex = 0; // 🚀 FIX: Ensure city reset for next worker category
                    continue;
                }

                const category = config.categories[catIdx]; progress.categoryIndex = catIdx;
                for (let cIdx = progress.cityIndex; cIdx < cities.length; cIdx++) {
                    const city = cities[cIdx]; progress.cityIndex = cIdx;

                    if (Date.now() - lastFullSyncTime > 180000) {
                         await syncFromSatellite(currentTargetUrl);
                    }

                    for (let subIdx = progress.subcategoryIndex; subIdx < category.sub.length; subIdx++) {
                        if (isStopping) break;
                        const subcategory = category.sub[subIdx]; progress.subcategoryIndex = subIdx;

                        // 🚀 HUMAN-LIKE DELAY: Prevent Google from detecting the bot speed
                        const wait = Math.floor(Math.random() * 10000) + 10000;
                        console.log(`\nWorker ${WORKER_ID} | WAIT | Resting for ${wait/1000}s...`);
                        await page.waitForTimeout(wait);

                        console.log(`Worker ${WORKER_ID} | SCAN | ${category.name} > ${subcategory} in ${city} (${state.name})`);
                        const result = await scrapeCombination(page, city, state.name, category.id, subcategory);

                        if (result === -1) {
                            console.log(`Worker ${WORKER_ID} | [STOP] | Shutting down to avoid skipping data...`);
                            await gracefulShutdown(true); // 🚀 EXIT WITH CODE 1 TO TRIGGER GITHUB RETRY
                            return;
                        }

                        await saveProgress();
                        if (!isStopping) await page.waitForTimeout(COOL_DOWN_MS);
                    }
                    if (isStopping) break;

                    console.log(`\nWorker ${WORKER_ID} | ✅ DONE | All sub-categories for ${category.name} in ${city} finished. Moving to next city...`);
                    progress.subcategoryIndex = 0;
                }
                if (isStopping) break;

                console.log(`\nWorker ${WORKER_ID} | 🏁 CATEGORY COMPLETE | ${category.name} finished for all cities in ${state.name}. Switching to next assigned category...`);
                progress.cityIndex = 0; // 🚀 FIX: Reset city for next category
            }
            if (isStopping) break;
            progress.categoryIndex = 0; // 🚀 FIX: Reset category for next state
        }
    } catch (fatal) {
        console.error(`Worker ${WORKER_ID} | FATAL | Loop Error: ${fatal.message}`);
    }

    console.log(`Worker ${WORKER_ID} | INFO | Job Finished or Terminated.`);
    await gracefulShutdown();
}

runOrchestrator();
