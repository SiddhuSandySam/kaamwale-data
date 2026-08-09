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
console.log(`   RAPIDHELP WORKER ${WORKER_ID} | VERSION: V65 | ORIGINAL-LOGIC-RESTORED`);
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
            console.log(`Worker ${WORKER_ID} | SYNC | Firestore: ${firestoreBuffer.length} leads saved.`);
            firestoreBuffer = [];
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

async function extractPortfolio(page) {
    try {
        if (page.isClosed()) return [];
        await page.evaluate(async () => {
            const h1 = document.querySelector('h1.DUwDvf');
            const panel = h1 ? h1.closest('div[role="main"], div[role="dialog"]') : document.querySelector('div[role="main"]');
            if (panel) { for (let i = 0; i < 3; i++) { panel.scrollBy(0, 800); await new Promise(r => setTimeout(r, 500)); } }
        });
        await page.waitForTimeout(1500);
        return await page.evaluate(() => {
            const links = new Set();
            const h1 = document.querySelector('h1.DUwDvf');
            const panel = h1 ? h1.closest('div[role="main"], div[role="dialog"]') : document.body;
            if (!panel) return [];
            panel.querySelectorAll('img').forEach(img => {
                const src = img.src || '';
                if (src.includes('googleusercontent.com') && !src.includes('base64')) {
                    if (src.includes('/a/') || src.includes('/a-/') || src.includes('shared-v1')) return;
                    links.add(src.split('=')[0].split('/s')[0] + '=w1000-h1000');
                }
            });
            return Array.from(links).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function scrapeIndividualProfile(page, businessName, city, state, categoryId, subcategory) {
    try {
        const phoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
        const cleanPhone = phoneStr.replace(/[^0-9]/g, '').slice(-10);

        if (!cleanPhone || cleanPhone.length < 10) {
            console.log(`Worker ${WORKER_ID} | [🛑] | Skip: No valid phone for ${businessName}`);
            return 0;
        }

        if (registry.has(cleanPhone)) return "DUPLICATE";

        // 🚀 RESTORED ADDRESS PARSING LOGIC FROM V48
        await page.waitForSelector('button[data-item-id="address"]', { timeout: 10000 }).catch(() => {});
        const fullAddress = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanFullAddress = fullAddress.replace('\n', '').replace('', '').trim();

        if (cleanFullAddress === "N/A" || cleanFullAddress.length < 5) {
            console.log(`Worker ${WORKER_ID} | [🛑] | Skip: No Address for ${businessName}`);
            return 0;
        }

        const addressParts = cleanFullAddress.split(',').map(p => p.trim());
        let detectedCity = city;
        let detectedLocality = city;

        if (addressParts.length >= 3) {
            const statePartIndex = addressParts.length - 1;
            const statePart = addressParts[statePartIndex];

            // 🛡️ STATE PROTECTION: Restored V48 logic
            if (!statePart.toLowerCase().includes(state.toLowerCase())) {
                console.log(`Worker ${WORKER_ID} | [🛑] | Skip: Wrong State (${statePart}) for ${businessName}`);
                return "WRONG_LOCATION";
            }

            detectedCity = addressParts[addressParts.length - 2];
            detectedLocality = addressParts[addressParts.length - 3];

            // Clean plot/shop numbers from locality
            if (/^\d+/.test(detectedLocality) || detectedLocality.toLowerCase().includes('plot') || detectedLocality.toLowerCase().includes('shop')) {
                if (addressParts.length >= 5) detectedLocality = addressParts[addressParts.length - 4];
            }
        }

        // 🚀 FETCH PORTFOLIO IMAGES (STRICT V48 LOGIC)
        let portfolio = await extractPortfolio(page);
        if (portfolio.length === 0) { await page.waitForTimeout(2000); portfolio = await extractPortfolio(page); }

        if (portfolio.length === 0) {
            console.log(`Worker ${WORKER_ID} | [!] | Skip: No Images (Quality Gate) for ${businessName}`);
            return 0;
        }

        const urlCoords = page.url().match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

        const provider = {
            id: `shadow_${cleanPhone}`,
            businessName: businessName,
            primaryCategoryId: categoryId,
            subcategory: subcategory,
            experienceYears: Math.floor(Math.random() * 5) + 1,
            serviceMode: "Local",
            city: detectedCity,
            locality: detectedLocality,
            state: state,
            startingPrice: 0,
            priceUnit: "Discuss on Call",
            whatsappNumber: cleanPhone,
            callNumber: cleanPhone,
            aboutDescription: `Professional ${subcategory} services available in ${detectedCity}. High-quality work guaranteed.`,
            isApproved: true,
            isVerified: false,
            rating: 0.0,
            profilePhotoUrl: portfolio[0] ? portfolio[0].split('=')[0] + '=w500-h500-k-no' : "",
            recommendationCount: 0,
            portfolioUrls: portfolio,
            searchKeywords: [businessName, detectedCity, subcategory, state],
            lastSeen: Date.now(),
            callCount: 0,
            fullAddress: cleanFullAddress,
            isNumberHidden: false,
            referredBy: "SYSTEM_SCRAPER",
            referralBonusPaid: false,
            fcmToken: "",
            notificationsEnabled: true,
            latitude: urlCoords ? parseFloat(urlCoords[1]) : 0,
            longitude: urlCoords ? parseFloat(urlCoords[2]) : 0
        };

        if (SYNC_FIRESTORE_ENABLED && db) firestoreBuffer.push(provider);
        if (SYNC_SHEET_ENABLED) sheetBuffer.push(provider);

        registry.add(cleanPhone);
        newLeadsCount++;
        console.log(`Worker ${WORKER_ID} | [+] | Saved: ${businessName} | Phone: ${cleanPhone} (Total: ${newLeadsCount})`);

        if (sheetBuffer.length >= BATCH_LIMIT || firestoreBuffer.length >= BATCH_LIMIT) await flushBuffers();
        return 1;
    } catch (err) { return 0; }
}

async function scrapeCombination(page, city, state, categoryId, subcategory) {
    if (isStopping) return 0;
    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(subcategory + " in " + city + ", " + state)}`);

        // Handle Consent
        const consentBtn = await page.$('button[aria-label="Accept all"]').catch(() => null);
        if (consentBtn) await consentBtn.click();

        // 🚀 SMART DETECTION (List vs Single vs Empty)
        const status = await Promise.race([
            page.waitForSelector('a.hfpxzc', { timeout: 60000 }).then(() => "LIST"),
            page.waitForSelector('h1.DUwDvf', { timeout: 25000 }).then(() => "SINGLE"),
            page.waitForSelector('div.fvP2If, div.H6v83d', { timeout: 15000 }).then(() => "EMPTY"),
            page.waitForTimeout(85000).then(() => "TIMEOUT")
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

        // --- Original List Scraping Logic ---
        await page.mouse.wheel(0, 3000);
        await page.waitForTimeout(2000);

        let streak = 0;
        let foundCount = 0;

        for (let i = 0; i < 30; i++) {
            if (isStopping) break;

            const listings = await page.$$('a.hfpxzc');
            if (i >= listings.length) break;

            const listing = listings[i];
            const nameRaw = await listing.getAttribute('aria-label').catch(() => null);
            if (!nameRaw) continue;

            try {
                await listing.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
                await listing.click({ timeout: 10000 });
            } catch (clickErr) { continue; }

            let updated = false;
            for (let r = 0; r < 12; r++) {
                const title = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "");
                if (title.toLowerCase().includes(nameRaw.toLowerCase().substring(0, 4))) {
                    updated = true; break;
                }
                await page.waitForTimeout(1000);
            }
            if (!updated) continue;

            const res = await scrapeIndividualProfile(page, nameRaw, city, state, categoryId, subcategory);
            if (res === 1) {
                foundCount++; streak = 0;
            } else if (res === "DUPLICATE") {
                streak++;
                console.log(`Worker ${WORKER_ID} | [-] | Skip: Duplicate (Streak: ${streak}/4)`);
                if (streak >= 4) {
                    console.log(`Worker ${WORKER_ID} | [🛑] | Streak Limit reached. Next category...`);
                    return foundCount;
                }
            }
        }
        return foundCount;
    } catch (e) {
        console.error(`Worker ${WORKER_ID} | [FATAL] | Scrape Error in ${city}: ${e.message}`);
        return -1;
    }
}

async function runOrchestrator() {
    await loadProgress();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    try {
        console.log(`Worker ${WORKER_ID} | INFO | Fetching Routing Table from Hub...`);
        const hubResp = await axios.get(`${MAIN_HUB_URL}?type=config`, { timeout: 30000 });
        if (hubResp.data && hubResp.data.stateUrls) {
            stateUrls = hubResp.data.stateUrls;
            console.log(`Worker ${WORKER_ID} | INFO | Hub Loaded.`);
        }
        for (let sIdx = progress.stateIndex; sIdx < config.states.length; sIdx++) {
            const state = config.states[sIdx]; progress.stateIndex = sIdx;
            currentTargetUrl = stateUrls[state.name];
            if (!currentTargetUrl) continue;

            await syncFromSatellite(currentTargetUrl);
            const cities = WORKER_ID % 2 === 0 ? [...state.cities].reverse() : [...state.cities];

            for (let catIdx = progress.categoryIndex; catIdx < config.categories.length; catIdx++) {
                if (catIdx % TOTAL_WORKERS !== WORKER_ID) { progress.cityIndex = 0; continue; }

                const category = config.categories[catIdx]; progress.categoryIndex = catIdx;
                for (let cIdx = progress.cityIndex; cIdx < cities.length; cIdx++) {
                    const city = cities[cIdx]; progress.cityIndex = cIdx;

                    for (let subIdx = progress.subcategoryIndex; subIdx < category.sub.length; subIdx++) {
                        if (isStopping) break;
                        const subcategory = category.sub[subIdx]; progress.subcategoryIndex = subIdx;

                        const wait = Math.floor(Math.random() * 10000) + 10000;
                        console.log(`\nWorker ${WORKER_ID} | WAIT | Resting for ${wait/1000}s...`);
                        await page.waitForTimeout(wait);

                        console.log(`Worker ${WORKER_ID} | SCAN | ${subcategory} in ${city}`);
                        const res = await scrapeCombination(page, city, state.name, category.id, subcategory);

                        if (res === -1) { await gracefulShutdown(true); return; }
                        await saveProgress();
                    }
                    if (isStopping) break;
                    console.log(`\nWorker ${WORKER_ID} | ✅ DONE | ${city} finished.`);
                    progress.subcategoryIndex = 0;
                }
                if (isStopping) break;
                progress.cityIndex = 0;
            }
            if (isStopping) break;
            progress.categoryIndex = 0;
        }
    } catch (fatal) {
        console.error(`Worker ${WORKER_ID} | FATAL | Loop Error: ${fatal.message}`);
    }
    await gracefulShutdown(false);
}

runOrchestrator();
