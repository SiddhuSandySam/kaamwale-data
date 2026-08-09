bhai he baghconst { chromium } = require('playwright');
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
const BACKUP_LEADS_FILE = path.join(__dirname, `backup_leads_W${WORKER_ID}.json`); // 🚀 NEW: Immediate disk backup
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');

// --- STARTUP HEADER ---
console.log("\n===============================================");
console.log(`   RAPIDHELP WORKER ${WORKER_ID} | VERSION: V48 | DATA-ARMOR`);
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

// Initialize SQLite registry from JSON if it's the first time
registry.migrateFromJson();

let progress = { stateIndex: 0, cityIndex: 0, categoryIndex: 0, subcategoryIndex: 0, lastRegistrySync: 0 };

async function loadProgress() {
    // 1. Try Local File first
    if (fs.existsSync(PROGRESS_FILE)) {
        progress = JSON.parse(fs.readFileSync(PROGRESS_FILE));
        console.log(`Worker ${WORKER_ID} | INFO | Local Progress Loaded.`);
    }

    // 2. Try Firebase (The ultimate truth)
    if (db) {
        try {
            const doc = await db.collection('metadata').doc(`progress_W${WORKER_ID}`).get();
            if (doc.exists) {
                progress = doc.data();
                console.log(`Worker ${WORKER_ID} | INFO | Firebase Progress Loaded.`);
            }
        } catch (e) {
            console.warn(`Worker ${WORKER_ID} | WARN | Could not load progress from Firebase.`);
        }
    }
}

let sheetBuffer = [];
let firestoreBuffer = [];
let isFlushing = false;
const BATCH_LIMIT = 100; // 🚀 BACK TO PRODUCTION: 100 leads per batch

async function saveProgress() {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    if (db) {
        await db.collection('metadata').doc(`progress_W${WORKER_ID}`).set(progress).catch(() => {});
    }
}

async function flushBuffers(isExiting = false) {
    if (isFlushing && !isExiting) return;

    if (isFlushing && isExiting) {
        console.log(`Worker ${WORKER_ID} | WAIT | Waiting for current sync to finish...`);
        while (isFlushing) { await new Promise(r => setTimeout(r, 500)); }
    }

    if (sheetBuffer.length === 0 && firestoreBuffer.length === 0) {
        if (isExiting) console.log(`Worker ${WORKER_ID} | INFO | Buffer is empty.`);
        return;
    }

    isFlushing = true;
    const mode = isExiting ? "EXIT" : "SYNC";

    try {
        // 1. Firestore Sync
        if (firestoreBuffer.length > 0 && db && SYNC_FIRESTORE_ENABLED) {
            const leads = [...firestoreBuffer];
            console.log(`Worker ${WORKER_ID} | [${mode}] | Firestore: Saving ${leads.length} leads...`);
            try {
                for (let i = 0; i < leads.length; i += 50) {
                    const chunk = leads.slice(i, i + 50);
                    const batch = db.batch();
                    chunk.forEach(p => {
                        const phone = p.id.replace('shadow_', '');
                        batch.set(db.collection('providers').doc(p.id), p, { merge: true });
                        batch.set(db.collection('scraped_phones').doc(phone), { timestamp: Date.now() });
                    });
                    await batch.commit();
                }
                console.log(`Worker ${WORKER_ID} | [${mode}] | Firestore: Success.`);
                firestoreBuffer = firestoreBuffer.filter(p => !leads.includes(p));
            } catch (e) {
                console.error(`Worker ${WORKER_ID} | [${mode}] | Firestore: Failed - ${e.message}`);
            }
        }

        // 2. Google Sheets Sync
        if (sheetBuffer.length > 0 && SYNC_SHEET_ENABLED) {
            let leadsToSync = [...sheetBuffer];
            let retryAttempt = 0;
            const MAX_RETRIES = 5;
            let success = false;

            while (retryAttempt < MAX_RETRIES && !success) {
                // 🚀 SMART RETRY: Check if some leads were actually saved despite previous errors
                if (retryAttempt > 0) {
                    await syncFromSatellite(currentTargetUrl);
                    const originalCount = leadsToSync.length;
                    leadsToSync = leadsToSync.filter(p => !registry.has(p.callNumber));

                    if (leadsToSync.length === 0) {
                        console.log(`Worker ${WORKER_ID} | [SUCCESS] | All ${originalCount} leads already saved in sheet. Breaking loop.`);
                        sheetBuffer = sheetBuffer.filter(p => !registry.has(p.callNumber));
                        if (fs.existsSync(BACKUP_LEADS_FILE)) fs.unlinkSync(BACKUP_LEADS_FILE);
                        if (fs.existsSync(FAILED_SYNC_FILE)) fs.unlinkSync(FAILED_SYNC_FILE);
                        success = true;
                        break;
                    } else if (leadsToSync.length < originalCount) {
                        console.log(`Worker ${WORKER_ID} | [RETRY] | ${originalCount - leadsToSync.length} leads found in sheet. Retrying with ${leadsToSync.length} remaining.`);
                    }
                }

                if (retryAttempt > 0 || !isExiting) {
                    const baseWait = retryAttempt === 0 ? 30000 : 30000 * Math.pow(2, retryAttempt);
                    const jitter = Math.floor(Math.random() * baseWait);
                    console.log(`Worker ${WORKER_ID} | [WAIT] | Attempt ${retryAttempt + 1}: Waiting ${Math.round(jitter/1000)}s`);
                    await new Promise(r => setTimeout(r, jitter));
                }

                console.log(`Worker ${WORKER_ID} | [${mode}] | Sheet: Syncing ${leadsToSync.length} leads to Satellite... (Attempt ${retryAttempt + 1})`);
                try {
                    const response = await axios.post(currentTargetUrl, {
                        type: "BATCH_PROVIDER_SYNC",
                        providers: leadsToSync
                    }, { timeout: 150000 });

                    const resData = String(response.data);
                    console.log(`Worker ${WORKER_ID} | [${mode}] | 📊 Sheet Response: ${resData} 🚀`);

                    if (resData.includes("Success") || resData.includes("Complete")) {
                        // Success! Clean up based on what we sent
                        const syncedPhones = leadsToSync.map(p => p.callNumber);
                        sheetBuffer = sheetBuffer.filter(p => !syncedPhones.includes(p.callNumber));

                        if (fs.existsSync(BACKUP_LEADS_FILE)) fs.unlinkSync(BACKUP_LEADS_FILE);
                        if (fs.existsSync(FAILED_SYNC_FILE)) fs.unlinkSync(FAILED_SYNC_FILE);

                        // 🚀 OPTIMIZED REGISTRY SYNC: Only sync if it's been more than 60 seconds
                        if (Date.now() - lastFullSyncTime > 60000) {
                            await syncFromSatellite(currentTargetUrl);
                        }
                        success = true;
                    } else if (resData.includes("Lock timeout")) {
                        console.warn(`Worker ${WORKER_ID} | WARN | Lock Timeout. Retrying...`);
                        retryAttempt++;
                    } else {
                        console.error(`Worker ${WORKER_ID} | ERROR | Server Error: ${resData}`);
                        if (isExiting) fs.writeFileSync(FAILED_SYNC_FILE, JSON.stringify(sheetBuffer, null, 2));
                        break;
                    }
                } catch (e) {
                    console.error(`Worker ${WORKER_ID} | [${mode}] | Sheet: Failed - ${e.message}`);
                    if (e.message.includes("timeout") || e.message.includes("429")) {
                        retryAttempt++;
                    } else {
                        if (isExiting) fs.writeFileSync(FAILED_SYNC_FILE, JSON.stringify(sheetBuffer, null, 2));
                        break;
                    }
                }
            }
        }
    } finally {
        isFlushing = false;
    }
}

async function syncFromSatellite(targetUrl) {
    if (!targetUrl) return;

    let cleanUrl = targetUrl.trim().split('?')[0];
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);

    let synced = false;
    let attempts = 0;

    while (!synced && !isStopping) {
        attempts++;
        console.log(`Worker ${WORKER_ID} | [SYNC] | 🔄 Syncing Registry (Attempt ${attempts}): ${cleanUrl}`);
        try {
            const response = await axios.get(`${cleanUrl}?type=get_ids`, {
                timeout: 90000,
                maxRedirects: 20,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            if (Array.isArray(response.data)) {
                console.log(`Worker ${WORKER_ID} | [SYNC] | Batching ${response.data.length} IDs to Registry...`);
                registry.addBatch(response.data);
                console.log(`Worker ${WORKER_ID} | [SYNC] | ✅ Registry Updated.`);
                lastFullSyncTime = Date.now();
                synced = true;
            } else {
                console.warn(`Worker ${WORKER_ID} | [SYNC] | ⚠️ Invalid data format received. Retrying in 15s...`);
                await new Promise(r => setTimeout(r, 15000));
            }
        } catch (e) {
            console.error(`Worker ${WORKER_ID} | [SYNC] | ❌ Sync Failed (Error ${e.response?.status || 'Net'}): ${e.message}`);
            console.log(`Worker ${WORKER_ID} | [SYNC] | ⏳ Persistent Retry: Waiting 20s...`);
            await new Promise(r => setTimeout(r, 20000));
        }
    }
}

let isStopping = false;
async function gracefulShutdown() {
    if (isStopping) return;
    isStopping = true;
    console.log(`\nWorker ${WORKER_ID} | [EXIT] | 🛑 Shutdown initiated. Securing data...`);

    if (sheetBuffer.length > 0) {
        try {
            fs.writeFileSync(FAILED_SYNC_FILE, JSON.stringify(sheetBuffer, null, 2));
            console.log(`Worker ${WORKER_ID} | [EXIT] | 📦 Local backup created.`);
        } catch (e) {}
    }

    const keepAlive = setInterval(() => {}, 1000);
    try {
        await flushBuffers(true);
        console.log(`Worker ${WORKER_ID} | [EXIT] | 🏁 ALL DATA PROCESSED SUCCESSFULLY.`);
    } finally {
        clearInterval(keepAlive);
        process.exit(0);
    }
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

let lastSyncedName = "";

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

async function scrapeCombination(page, city, state, categoryId, subcategory) {
    if (isStopping || page.isClosed()) return 0;
    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(subcategory + " in " + city + ", " + state)}`);
        // 🚀 INCREASED TIMEOUT: Wait up to 5 minutes (300,000ms) for very slow responses
        await page.waitForSelector('a.hfpxzc', { timeout: 300000 });
    } catch (e) {
        // 🛡️ BLOCK/TIMEOUT PROTECTION: If map doesn't load even after 5 mins, STOP to prevent skipping.
        console.error(`Worker ${WORKER_ID} | [FATAL] | Google Maps not responding after 5 mins in ${city}. Stopping current run.`);
        return -1;
    }
    for (let i = 0; i < 2; i++) { if (isStopping || page.isClosed()) return 0; await page.mouse.wheel(0, 3000); await page.waitForTimeout(1000); }

    let newLeadsCount = 0;
    let duplicateStreak = 0;
    const STREAK_LIMIT = 4; // 🚀 OPTIMIZED: Skip faster if 4 duplicates found in a row

    for (let i = 0; i < 30; i++) {
        try {
            if (isStopping || page.isClosed()) return newLeadsCount;

            const listings = await page.$$('a.hfpxzc');
            if (i >= listings.length) break;
            const listing = listings[i];
            const nameRaw = await listing.getAttribute('aria-label').catch(() => "Unknown");

            await listing.scrollIntoViewIfNeeded();
            await listing.click();

            let isSynced = false;
            let syncRetry = 0;
            const target = nameRaw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 6);

            while (syncRetry < 16) {
                const title = (await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "")).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (title.includes(target) && title !== lastSyncedName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()) { isSynced = true; break; }
                await page.waitForTimeout(500); syncRetry++;
            }
            if (!isSynced) continue;

            await page.waitForTimeout(1000);
            const businessName = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => nameRaw);
            const phoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
            const cleanPhone = phoneStr.replace(/[^0-9]/g, '').slice(-10);

            // 🛡️ STRICT DUPLICATE CHECK
            if (!cleanPhone || cleanPhone.length < 10 || registry.has(cleanPhone)) {
                if (registry.has(cleanPhone)) {
                    duplicateStreak++;
                    console.log(`Worker ${WORKER_ID} | [-] | Skip: ${nameRaw.substring(0, 15)}... | Phone: ${cleanPhone} (Streak: ${duplicateStreak}/${STREAK_LIMIT})`);

                    if (duplicateStreak >= STREAK_LIMIT) {
                        console.log(`Worker ${WORKER_ID} | [🛑] | Streak Limit reached. Moving to next city.`);
                        return newLeadsCount; // Early exit from this search
                    }
                }
                continue;
            }

            // ⚡ RESET STREAK: Found a truly unique lead!
            duplicateStreak = 0;

            let portfolio = await extractPortfolio(page);
            if (portfolio.length === 0) { await page.waitForTimeout(2000); portfolio = await extractPortfolio(page); }
            if (portfolio.length === 0) { console.log(`Worker ${WORKER_ID} | [!] | No Images: ${businessName}`); continue; }

            const fullAddress = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
            const urlCoords = page.url().match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            let latitude = urlCoords ? parseFloat(urlCoords[1]) : 0;
            let longitude = urlCoords ? parseFloat(urlCoords[2]) : 0;

            // 🚀 SMART ADDRESS PARSING 🛡️ (Updated for India suffix)
            const cleanFullAddress = fullAddress.replace('\n', '').replace('', '').trim();
            const addressParts = cleanFullAddress.split(',').map(p => p.trim());

            let detectedCity = city;
            let detectedLocality = city;

            if (addressParts.length >= 2) {
                let statePartIndex = addressParts.length - 1;

                // If last part is "India", check the part before it
                if (addressParts[statePartIndex].toLowerCase() === "india" && addressParts.length >= 3) {
                    statePartIndex--;
                }

                const statePart = addressParts[statePartIndex];
                const cityPart = addressParts[statePartIndex - 1];

                // 🛑 Cross-State Protection (Case Insensitive)
                if (!statePart.toLowerCase().includes(state.toLowerCase())) {
                    console.log(`Worker ${WORKER_ID} | [🛑] | Skip: Result in wrong state (${statePart})`);
                    continue;
                }

                detectedCity = cityPart;

                // Extract Locality (the part before City)
                if (statePartIndex >= 2) {
                    detectedLocality = addressParts[statePartIndex - 2];
                } else {
                    detectedLocality = detectedCity;
                }
            }

            // 🛡️ INDIA GUARD: Filter out N/A addresses or ocean coordinates
            const isLatValid = latitude > 6.0 && latitude < 38.5;
            const isLonValid = longitude > 68.0 && longitude < 98.5;
            const isAddrValid = cleanFullAddress && cleanFullAddress !== "N/A" && cleanFullAddress.length > 5;

            if (!isLatValid || !isLonValid || !isAddrValid) {
                console.log(`Worker ${WORKER_ID} | [🛑] | Junk Skip: ${businessName.substring(0, 15)}... | Reason: ${!isAddrValid ? "No Address" : "Ocean Coords"}`);
                continue;
            }

            const provider = {
                id: `shadow_${cleanPhone}`,
                businessName: businessName,
                primaryCategoryId: categoryId,
                subcategory: subcategory,
                experienceYears: Math.floor(Math.random() * 5) + 1, // 🚀 Fixed: Random experience (1-5 yrs)
                serviceMode: "Local",
                city: detectedCity, // 🛡️ DETECTED CITY
                locality: detectedLocality, // 🛡️ DETECTED LOCALITY
                state: state,
                fullAddress: cleanFullAddress,
                whatsappNumber: cleanPhone,
                callNumber: cleanPhone,
                profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                portfolioUrls: portfolio,
                rating: 0.0, // 🛡️ FIXED: Changed from 5.0 to 0.0
                isApproved: true,
                isVerified: false, // 🛡️ GLOBAL RESET: New leads are not verified
                recommendationCount: 0, // 🛡️ Also resetting recommendation
                lastSeen: Date.now(),
                callCount: 0,
                latitude: latitude,
                longitude: longitude,
                referredBy: "SYSTEM_SCRAPER",
                referralBonusPaid: false,
                fcmToken: "",
                notificationsEnabled: true,
                isNumberHidden: false,
                searchKeywords: [businessName, detectedCity, subcategory, detectedLocality],
                priceUnit: "Discuss on Call",
                startingPrice: 0,
                aboutDescription: `Professional ${subcategory} services available in ${detectedCity}. High-quality work guaranteed by local experts.`
            };

            if (SYNC_FIRESTORE_ENABLED && db) firestoreBuffer.push(provider);
            if (SYNC_SHEET_ENABLED) sheetBuffer.push(provider);

            // 🚀 IMMEDIATE DISK BACKUP: Prevent data loss if crash happens before 50 leads
            try {
                let currentBackup = [];
                if (fs.existsSync(BACKUP_LEADS_FILE)) currentBackup = JSON.parse(fs.readFileSync(BACKUP_LEADS_FILE));
                currentBackup.push(provider);
                fs.writeFileSync(BACKUP_LEADS_FILE, JSON.stringify(currentBackup, null, 2));
            } catch (backupErr) {}

            if (sheetBuffer.length >= BATCH_LIMIT || firestoreBuffer.length >= BATCH_LIMIT) { await flushBuffers(); }
            console.log(`Worker ${WORKER_ID} | [+] | Found: ${businessName} | Phone: ${cleanPhone}`);
            lastSyncedName = businessName;
            registry.add(cleanPhone);
            newLeadsCount++;
        } catch (err) {}
    }
    return newLeadsCount;
}

async function runOrchestrator() {
    await loadProgress(); // 🚀 LOAD PROGRESS BEFORE STARTING
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    // 🚀 INITIAL JITTER: Workers 1-4 wait to avoid concurrent Hub hits
    if (WORKER_ID > 0) {
        const initialWait = WORKER_ID * 10000; // 10s, 20s, 30s, 40s
        console.log(`Worker ${WORKER_ID} | STARTUP | Waiting ${initialWait/1000}s for staggered start...`);
        await new Promise(r => setTimeout(r, initialWait));
    }

    let retryCount = 0;
    const MAX_HUB_RETRIES = 20;

    while (retryCount < MAX_HUB_RETRIES) {
        try {
            console.log(`Worker ${WORKER_ID} | INFO | Fetching Routing Table from Hub... (Attempt ${retryCount + 1}/${MAX_HUB_RETRIES})`);
            const hubResp = await axios.get(`${MAIN_HUB_URL}?type=config`, { timeout: 30000 });

            if (hubResp.data && hubResp.data.stateUrls) {
                stateUrls = hubResp.data.stateUrls;
                console.log(`Worker ${WORKER_ID} | INFO | Hub Loaded. Active States: ${Object.keys(stateUrls).join(', ')}`);
                break; // 🚀 Success! Exit the retry loop
            } else {
                throw new Error("Invalid config structure received from Hub.");
            }
        } catch (e) {
            retryCount++;
            console.error(`Worker ${WORKER_ID} | WARN | Hub Connection Failed: ${e.message}`);

            if (retryCount >= MAX_HUB_RETRIES) {
                console.error(`Worker ${WORKER_ID} | FATAL | Max retries reached. Shutting down.`);
                await browser.close();
                process.exit(1);
            }

            const waitTime = 5000 + (retryCount * 2000); // Incremental wait
            console.log(`Worker ${WORKER_ID} | RETRY | Waiting ${waitTime/1000}s before next attempt...`);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }

    if (fs.existsSync(FAILED_SYNC_FILE) || fs.existsSync(BACKUP_LEADS_FILE)) {
        try {
            const failedLeads = fs.existsSync(FAILED_SYNC_FILE) ?
                                JSON.parse(fs.readFileSync(FAILED_SYNC_FILE)) :
                                JSON.parse(fs.readFileSync(BACKUP_LEADS_FILE));

            if (failedLeads.length > 0) {
                // 🚀 SMART RECOVERY: Send recovery data to MAIN_HUB so it can route them correctly
                console.log(`Worker ${WORKER_ID} | RECOVERY | Found ${failedLeads.length} leads. Routing via Main Hub...`);
                const tempUrl = currentTargetUrl; // Save current
                currentTargetUrl = MAIN_HUB_URL;
                sheetBuffer.push(...failedLeads); firestoreBuffer.push(...failedLeads);
                await flushBuffers();
                currentTargetUrl = tempUrl; // Restore
            }
        } catch (e) {}
    }

    try {
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
                        console.log(`\nWorker ${WORKER_ID} | SCAN | ${category.name} > ${subcategory} in ${city} (${state.name})`);
                        const result = await scrapeCombination(page, city, state.name, category.id, subcategory);

                        if (result === -1) {
                            console.log(`Worker ${WORKER_ID} | [STOP] | Shutting down to avoid skipping data...`);
                            await gracefulShutdown();
                            return;
                        }

                        await saveProgress();
                        if (!isStopping) await page.waitForTimeout(COOL_DOWN_MS);
                    }
                    if (isStopping) break; progress.subcategoryIndex = 0;
                }
                if (isStopping) break;
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
