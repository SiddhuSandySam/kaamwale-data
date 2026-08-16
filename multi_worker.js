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
const MAX_SESSION_TIME_MS = 330 * 60 * 1000; // 🚀 5.5 Hours Marathon Run!
const START_TIMESTAMP = Date.now();

// FILE PATHS
const CONFIG_FILE = path.join(__dirname, 'config.json');
const REGISTRY_FILE = path.join(__dirname, 'master_registry.json');
const PROGRESS_FILE = path.join(__dirname, `progress_W${WORKER_ID}.json`);
const FAILED_SYNC_FILE = path.join(__dirname, `failed_sync_W${WORKER_ID}.json`);
const BACKUP_LEADS_FILE = path.join(__dirname, `backup_leads_W${WORKER_ID}.json`);
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');

// --- STARTUP HEADER ---
console.log("\n===============================================");
console.log(`   RAPIDHELP WORKER ${WORKER_ID} | VERSION: V77 | DATA-ARMOR-ULTIMATE`);
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
        console.log(`Worker ${WORKER_ID} | INFO | Local Progress Loaded.`);
    }
    if (db) {
        try {
            const doc = await db.collection('metadata').doc(`progress_W${WORKER_ID}`).get();
            if (doc.exists) {
                progress = doc.data();
                console.log(`Worker ${WORKER_ID} | INFO | Firebase Progress Loaded.`);
            }
        } catch (e) {}
    }
}

let sheetBuffer = [];
let firestoreBuffer = [];
let isFlushing = false;
let newLeadsCount = 0;
const BATCH_LIMIT = 150;

async function saveProgress() {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    if (db) {
        await db.collection('metadata').doc(`progress_W${WORKER_ID}`).set(progress).catch(() => {});
    }
}

async function flushBuffers(isExiting = false) {
    if (isFlushing && !isExiting) return;
    if (isFlushing && isExiting) { while (isFlushing) { await new Promise(r => setTimeout(r, 500)); } }
    if (sheetBuffer.length === 0 && firestoreBuffer.length === 0) return;

    isFlushing = true;
    const mode = isExiting ? "EXIT" : "SYNC";

    try {
        // 1. Firestore Sync
        if (firestoreBuffer.length > 0 && db && SYNC_FIRESTORE_ENABLED) {
            console.log(`Worker ${WORKER_ID} | [${mode}] | Firestore: Saving ${firestoreBuffer.length} leads...`);
            const leads = [...firestoreBuffer];
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
                console.log(`Worker ${WORKER_ID} | [SYNC] | ✅ Firestore: Success. Saved ${leads.length} leads.`);
                firestoreBuffer = firestoreBuffer.filter(p => !leads.includes(p));
            } catch (e) {
                console.error(`Worker ${WORKER_ID} | [SYNC] | ❌ Firestore Failed: ${e.message}. Retrying in next cycle...`);
            }
        }

        // 2. Google Sheets Sync
        if (sheetBuffer.length > 0 && SYNC_SHEET_ENABLED) {
            const groupedLeads = {};
            sheetBuffer.forEach(p => {
                const s = p.state || "Unknown";
                if (!groupedLeads[s]) groupedLeads[s] = [];
                groupedLeads[s].push(p);
            });

            let overallSuccess = true;
            for (const stateName of Object.keys(groupedLeads)) {
                let leadsToSync = groupedLeads[stateName];
                const targetUrl = stateUrls[stateName] || currentTargetUrl;

                // 🚀 DETAILED LOGGING: Show names of leads being synced
                const leadNames = leadsToSync.map(l => l.businessName || l.id).join(", ");
                console.log(`Worker ${WORKER_ID} | [${mode}] | 🚀 Routing ${leadsToSync.length} leads to [${stateName}] Sheet...`);
                console.log(`Worker ${WORKER_ID} | [DATA] | Leads: [${leadNames}]`);

                let retryAttempt = 0;
                const MAX_RETRIES = 10;
                let stateSuccess = false;

                while (retryAttempt < MAX_RETRIES && !stateSuccess) {
                    retryAttempt++;
                    if (retryAttempt > 1) {
                        const waitTime = Math.min(30000 * retryAttempt, 120000);
                        console.log(`Worker ${WORKER_ID} | ⏳ Retry ${retryAttempt}/${MAX_RETRIES} in ${waitTime/1000}s...`);
                        await new Promise(r => setTimeout(r, waitTime));
                    }

                    try {
                        const response = await axios.post(targetUrl, { type: "BATCH_PROVIDER_SYNC", providers: leadsToSync }, { timeout: 240000 });
                        const resData = String(response.data);

                        if (resData.includes("Success") || resData.includes("Complete")) {
                            console.log(`Worker ${WORKER_ID} | [${mode}] | ✅ [${stateName}] Sync Success for: [${leadNames}]`);
                            stateSuccess = true;
                        } else {
                            console.warn(`Worker ${WORKER_ID} | [${mode}] | ⚠️ [${stateName}] Server Busy/Error: ${resData}`);
                            // If server specifically says error, don't count as success
                        }
                    } catch (e) {
                        console.error(`Worker ${WORKER_ID} | [${mode}] | ❌ [${stateName}] Sync Error: ${e.message}`);
                    }
                }
                if (!stateSuccess) overallSuccess = false;
            }

            if (overallSuccess) {
                // 🚀 ONLY DELETE IF ALL BATCHES SUCCEEDED
                sheetBuffer = [];
                if (fs.existsSync(BACKUP_LEADS_FILE)) {
                    fs.unlinkSync(BACKUP_LEADS_FILE);
                    console.log(`Worker ${WORKER_ID} | [${mode}] | 🧹 Success! Local backup [${path.basename(BACKUP_LEADS_FILE)}] deleted.`);
                }
                if (fs.existsSync(FAILED_SYNC_FILE)) fs.unlinkSync(FAILED_SYNC_FILE);
            } else {
                console.error(`Worker ${WORKER_ID} | [${mode}] | 🛑 Sync Failed after all retries. Backup kept for safety.`);
            }
        }
    } finally { isFlushing = false; }
}

async function syncFromSatellite(targetUrl) {
    if (!targetUrl) return;
    let cleanUrl = targetUrl.trim().split('?')[0];
    try {
        const response = await axios.get(`${cleanUrl}?type=get_ids`, { timeout: 90000 });
        if (Array.isArray(response.data)) {
            registry.addBatch(response.data);
            console.log(`Worker ${WORKER_ID} | [SYNC] | ✅ Registry Updated.`);
            lastFullSyncTime = Date.now();
        }
    } catch (e) {}
}

let isStopping = false;
async function gracefulShutdown(isError = false) {
    if (isStopping) return;
    isStopping = true;
    console.log(`\nWorker ${WORKER_ID} | [EXIT] | 🛑 Shutdown initiated. Securing data...`);

    // 1. Create emergency backup of currently buffered leads
    if (sheetBuffer.length > 0 || firestoreBuffer.length > 0) {
        try {
            const combinedLeads = [...new Set([...sheetBuffer, ...firestoreBuffer])];
            fs.writeFileSync(FAILED_SYNC_FILE, JSON.stringify(combinedLeads, null, 2));
            console.log(`Worker ${WORKER_ID} | [EXIT] | 📦 Emergency backup created (${combinedLeads.length} leads).`);
        } catch (e) {
            console.error(`Worker ${WORKER_ID} | [EXIT] | Backup Failed: ${e.message}`);
        }
    }

    // 2. Try one final sync attempt
    try {
        await flushBuffers(true);
        console.log(`Worker ${WORKER_ID} | [EXIT] | 🏁 FINAL SYNC COMPLETED.`);

        // If sync succeeded, remove the emergency backup
        if (fs.existsSync(FAILED_SYNC_FILE)) fs.unlinkSync(FAILED_SYNC_FILE);
        if (fs.existsSync(BACKUP_LEADS_FILE)) fs.unlinkSync(BACKUP_LEADS_FILE);
    } catch (e) {
        console.error(`Worker ${WORKER_ID} | [EXIT] | Final sync failed, keeping local backup.`);
    } finally {
        await saveProgress();
        process.exit(isError ? 1 : 0);
    }
}

process.on('SIGINT', () => gracefulShutdown(false));
process.on('SIGTERM', () => gracefulShutdown(false));

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
        // 🚀 RELIABLE EXTRACTION
        await page.waitForSelector('button[data-item-id^="phone"]', { timeout: 15000 }).catch(() => {});
        const phoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
        const cleanPhone = phoneStr.replace(/[^0-9]/g, '').slice(-10);

        // 🛡️ JUNK PHONE FILTER: India numbers start with 6-9
        const firstDigit = cleanPhone[0];
        if (!cleanPhone || cleanPhone.length < 10 || !['6', '7', '8', '9'].includes(firstDigit)) {
            console.log(`Worker ${WORKER_ID} | [🛑] | SKIP | Business: ${businessName} | Reason: Invalid/Junk Phone (${cleanPhone})`);
            return 0;
        }

        if (registry.has(cleanPhone)) {
            console.log(`Worker ${WORKER_ID} | [-] | SKIP | Business: ${businessName} | Phone: ${cleanPhone} | Reason: Duplicate (Registry)`);
            return { status: "DUPLICATE", phone: cleanPhone };
        }

        await page.waitForSelector('button[data-item-id="address"]', { timeout: 15000 }).catch(() => {});
        const fullAddress = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanFullAddress = fullAddress.replace('\n', '').replace('', '').trim();

        if (cleanFullAddress === "N/A" || !cleanFullAddress) {
            console.log(`Worker ${WORKER_ID} | [🛑] | SKIP | Business: ${businessName} | Reason: No Address Found`);
            return 0;
        }

        const urlCoords = page.url().match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        let latitude = urlCoords ? parseFloat(urlCoords[1]) : 0;
        let longitude = urlCoords ? parseFloat(urlCoords[2]) : 0;

        // 🛡️ INDIA GUARD & ADDRESS VALIDATION
        const addressParts = cleanFullAddress.split(',').map(p => p.trim());
        let detectedCity = city;
        let detectedLocality = city;
        let detectedState = state;

        if (addressParts.length >= 3) {
            let stateIdx = addressParts.length - 1;
            if (addressParts[stateIdx].toLowerCase() === "india" && addressParts.length >= 4) stateIdx--;
            const statePart = addressParts[stateIdx];

            // 🚀 STRICT STATE MISMATCH GUARD: Ensure Andhra stays in Andhra!
            if (!statePart.toLowerCase().includes(state.toLowerCase())) {
                console.log(`Worker ${WORKER_ID} | [🛑] | SKIP | Business: ${businessName} | Reason: State Mismatch (Detected: ${statePart}, Expected: ${state})`);
                return 0;
            }
            detectedCity = addressParts[stateIdx - 1];
            detectedState = statePart;

            // 🛡️ SMART LOCALITY EXTRACTION: Enhanced filter to remove landmarks and numeric parts
            const JUNK_KEYWORDS = [
                'building', 'shop', 'floor', 'plot', 'opp', 'near', 'room', 'flat', 'house', 'no', 'number', 'block',
                'phase', 'lane', 'industrial', 'highway', 'road', 'rd', 'marg', 'st', 'station', 'bus stop', 'society',
                'apt', 'apartment', 'villa', 'tower', 'beside', 'behind', 'temple', 'hospital', 'school', 'church',
                'masjid', 'gate', 'mall', 'market', 'complex', 'center', 'centre', 'chowk', 'circle', 'bypass', 'yard',
                'ward', 'street', 'gali', 'sector', 'khasra'
            ];

            let foundLocality = "";
            for (let i = stateIdx - 2; i >= 0; i--) {
                const part = addressParts[i].trim();
                const partLower = part.toLowerCase();

                // 🚀 ADVANCED HOUSE/CODE FILTER: Matches "2 & 3", "12-A", "Ward 4", pure numbers, etc.
                const isJunkCode = /^[0-9\-\/\&\s\.\#]+$/.test(part) ||
                                 (part.length <= 5 && /[0-9]/.test(part)) ||
                                 (partLower.includes('&') && part.length <= 10);

                const hasJunkWords = JUNK_KEYWORDS.some(k => partLower.includes(k));

                if (!isJunkCode && !hasJunkWords && part.length > 2) {
                    foundLocality = part;
                    break;
                }
            }
            detectedLocality = foundLocality || detectedCity;
        }

        const isLatValid = latitude > 6.0 && latitude < 38.5;
        const isLonValid = longitude > 68.0 && longitude < 98.5;
        if (!isLatValid || !isLonValid) {
            console.log(`Worker ${WORKER_ID} | [🛑] | SKIP | Business: ${businessName} | Reason: Ocean Coordinates (Lat:${latitude}, Lon:${longitude})`);
            return 0;
        }

        let portfolio = await extractPortfolio(page);
        if (portfolio.length === 0) { await page.waitForTimeout(3000); portfolio = await extractPortfolio(page); }

        // 🛡️ STRICT QUALITY CHECK: MUST HAVE IMAGES
        if (!portfolio || portfolio.length === 0) {
            console.log(`Worker ${WORKER_ID} | [🛑] | SKIP | Business: ${businessName} | Reason: No Portfolio Images Found`);
            return 0;
        }

        const provider = {
            id: `shadow_${cleanPhone}`,
            businessName: businessName,
            primaryCategoryId: categoryId,
            subcategory: subcategory,
            experienceYears: Math.floor(Math.random() * 5) + 1,
            serviceMode: "Local",
            city: detectedCity, locality: detectedLocality, state: state,
            startingPrice: 0, priceUnit: "Discuss on Call",
            whatsappNumber: cleanPhone, callNumber: cleanPhone,
            aboutDescription: `Professional ${subcategory} services available in ${detectedCity}. High-quality work guaranteed by local experts.`,
            isApproved: true, isVerified: false, rating: 0.0,
            profilePhotoUrl: portfolio[0] ? portfolio[0].split('=')[0] + '=w500-h500-k-no' : "",
            recommendationCount: 0, portfolioUrls: portfolio,
            searchKeywords: [businessName, detectedCity, subcategory, state],
            lastSeen: Date.now(), callCount: 0, fullAddress: cleanFullAddress,
            isNumberHidden: false, referredBy: "SYSTEM_SCRAPER", referralBonusPaid: false, fcmToken: "",
            notificationsEnabled: true, latitude: latitude, longitude: longitude
        };

        // 🚀 STRICT DATA INTEGRITY GUARD: Ensure NO junk enters the system
        const requiredFields = ['businessName', 'whatsappNumber', 'city', 'state', 'latitude', 'longitude', 'profilePhotoUrl'];
        const missingFields = requiredFields.filter(field => !provider[field] || provider[field] === 0 || provider[field] === "0");

        if (missingFields.length > 0) {
            console.log(`Worker ${WORKER_ID} | [🛑] | REJECT | Business: ${businessName} | Reason: Missing fields (${missingFields.join(', ')})`);
            return 0;
        }

        if (provider.latitude === 0 || provider.longitude === 0) {
            console.log(`Worker ${WORKER_ID} | [🛑] | REJECT | Business: ${businessName} | Reason: Invalid Coordinates (0,0)`);
            return 0;
        }

        firestoreBuffer.push(provider); sheetBuffer.push(provider);

        // 🚀 IMMEDIATE DISK BACKUP
        try {
            let currentBackup = [];
            if (fs.existsSync(BACKUP_LEADS_FILE)) {
                try {
                    currentBackup = JSON.parse(fs.readFileSync(BACKUP_LEADS_FILE));
                } catch (e) { currentBackup = []; }
            }
            currentBackup.push(provider);
            fs.writeFileSync(BACKUP_LEADS_FILE, JSON.stringify(currentBackup, null, 2));
        } catch (e) {
            console.error(`Worker ${WORKER_ID} | ⚠️ | Backup Write Fail: ${e.message}`);
        }

        if (sheetBuffer.length >= BATCH_LIMIT || firestoreBuffer.length >= BATCH_LIMIT) await flushBuffers();
        const finalPhone = cleanPhone.replace(/[^0-9]/g, '').slice(-10);
        console.log(`Worker ${WORKER_ID} | [+] | Saved: ${businessName} | Phone: ${finalPhone} (Total: ${++newLeadsCount})`);
        registry.add(cleanPhone);
        return 1;
    } catch (err) { return 0; }
}

async function scrapeCombination(page, city, state, categoryId, subcategory) {
    if (isStopping || page.isClosed()) return 0;
    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(subcategory + " in " + city + ", " + state)}`, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {});

        // 🚀 RESILIENT STATE DETECTION
        const status = await Promise.race([
            page.waitForSelector('a.hfpxzc', { timeout: 45000 }).then(() => "LIST").catch(() => new Promise(() => {})),
            page.waitForSelector('h1.DUwDvf', { timeout: 30000 }).then(() => "SINGLE").catch(() => new Promise(() => {})),
            page.waitForSelector('div.fvP2If', { timeout: 20000 }).then(() => "EMPTY").catch(() => new Promise(() => {})),
            page.waitForTimeout(65000).then(() => "TIMEOUT")
        ]);

        if (status === "EMPTY") {
            console.log(`Worker ${WORKER_ID} | [-] | No results for ${subcategory} in ${city}.`);
            return 0;
        }

        if (status === "TIMEOUT") {
            console.log(`Worker ${WORKER_ID} | [!] | Page Load Timeout for ${subcategory}. Skipping...`);
            return 0;
        }

        if (status === "SINGLE") {
            console.log(`Worker ${WORKER_ID} | [!] | Direct Profile detected.`);
            const name = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "Unknown");
            return await scrapeIndividualProfile(page, name, city, state, categoryId, subcategory);
        }

        // 🚀 DEEP SCROLL: Load more listings
        for (let i = 0; i < 8; i++) {
            if (isStopping || page.isClosed()) break;
            await page.mouse.wheel(0, 4000);
            await page.waitForTimeout(1500);
        }

        let streak = 0;
        let foundCount = 0;
        const MAX_LISTINGS = 100; // 🚀 Increased depth

        for (let i = 0; i < MAX_LISTINGS; i++) {
            if (isStopping || page.isClosed()) break;
            const listings = await page.$$('a.hfpxzc');
            if (i >= listings.length) break;
            const listing = listings[i];
            const nameRaw = await listing.getAttribute('aria-label').catch(() => "Unknown");

            await listing.scrollIntoViewIfNeeded(); await listing.click({ force: true });

            let updated = false;
            for (let r = 0; r < 12; r++) {
                const title = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "");
                if (title.toLowerCase().includes(nameRaw.toLowerCase().substring(0, 4))) { updated = true; break; }
                await page.waitForTimeout(1000);
            }
            if (!updated) continue;

            const res = await scrapeIndividualProfile(page, nameRaw, city, state, categoryId, subcategory);
            if (res === 1) {
                foundCount++;
                streak = 0;
            } else {
                streak++;
                if (res && res.status === "DUPLICATE") {
                    console.log(`Worker ${WORKER_ID} | [-] | Skip: Duplicate Number: ${res.phone} (Streak: ${streak}/4)`);
                } else {
                    console.log(`Worker ${WORKER_ID} | [-] | Skip: Invalid/Poor Quality (Streak: ${streak}/4)`);
                }

                if (streak >= 4) {
                    console.log(`Worker ${WORKER_ID} | [!] | Streak hit. Moving to next sub-category...`);
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
    // 🚀 INITIAL STAGGER: Wait before doing ANYTHING (including recovery/firebase)
    if (WORKER_ID > 0) {
        const startupDelay = WORKER_ID * 60 * 1000;
        console.log(`Worker ${WORKER_ID} | STAGGER | Waiting ${WORKER_ID} minute(s) before initialization...`);
        await new Promise(r => setTimeout(r, startupDelay));
    }

    await loadProgress();

    // 🚀 STARTUP RECOVERY: Loop until all failed data is successfully synced
    const recoveryFiles = [BACKUP_LEADS_FILE, FAILED_SYNC_FILE];
    for (const file of recoveryFiles) {
        if (!fs.existsSync(file)) continue;

        let syncSuccess = false;
        let attempt = 0;

        try {
            const failedLeads = JSON.parse(fs.readFileSync(file));
            if (failedLeads.length === 0) { fs.unlinkSync(file); continue; }

            console.log(`Worker ${WORKER_ID} | RECOVERY | Syncing ${failedLeads.length} leads from ${path.basename(file)}...`);

            // 🚀 CHUNKED RECOVERY: Send in batches of 50 to avoid Google Script Timeouts
            for (let i = 0; i < failedLeads.length; i += 50) {
                const chunk = failedLeads.slice(i, i + 50);
                let chunkSuccess = false;
                let chunkAttempt = 0;

                console.log(`Worker ${WORKER_ID} | RECOVERY | Batch ${Math.floor(i/50) + 1}/${Math.ceil(failedLeads.length/50)} | Sending ${chunk.length} leads...`);

                while (!chunkSuccess) {
                    chunkAttempt++;
                    try {
                        const response = await axios.post(MAIN_HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: chunk }, { timeout: 150000 });
                        const resData = String(response.data);

                        // 🚀 STRICT SUCCESS CHECK: Delete ONLY if server confirms receipt
                        if (resData.includes("Success") || resData.includes("Complete") || resData.includes("already exists")) {
                            console.log(`Worker ${WORKER_ID} | RECOVERY | ✅ Batch Success confirmed by Server.`);
                            chunkSuccess = true;
                        } else {
                            console.warn(`Worker ${WORKER_ID} | RECOVERY | ⚠️ Server Busy (Attempt ${chunkAttempt}). Retrying until Success...`);
                            await new Promise(r => setTimeout(r, 30000));
                        }
                    } catch (e) {
                        console.error(`Worker ${WORKER_ID} | RECOVERY | ❌ Connection Error (Attempt ${chunkAttempt}): ${e.message}. Waiting for Server to recover...`);
                        await new Promise(r => setTimeout(r, 60000));
                    }
                }
            }

            // If we processed chunks, delete the file to stop the loop for next run
            console.log(`Worker ${WORKER_ID} | RECOVERY | ✅ Restored data from ${path.basename(file)}.`);
            if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (e) {
            console.error(`Worker ${WORKER_ID} | RECOVERY | ❌ Critical Recovery Fail: ${e.message}`);
        }
    }

    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();


    try {
        // 🚀 SMART HUB LOADING: Use local hub_data.json first, fallback to CDN, then API
        const HUB_DATA_FILE = path.join(__dirname, 'hub_data.json');
        const CDN_HUB_URL = "https://cdn.jsdelivr.net/gh/SiddhuSandySam/kaamwale-data@main/hub_data.json";
        let hubLoaded = false;

        // 1. Try Local File
        if (fs.existsSync(HUB_DATA_FILE)) {
            try {
                const localHub = JSON.parse(fs.readFileSync(HUB_DATA_FILE));
                if (localHub && localHub.stateUrls) {
                    stateUrls = localHub.stateUrls;
                    console.log(`Worker ${WORKER_ID} | INFO | Hub Data loaded from local hub_data.json.`);
                    hubLoaded = true;
                }
            } catch (e) { console.error(`Worker ${WORKER_ID} | ⚠️ | Local Hub Read Fail: ${e.message}`); }
        }

        // 2. Try CDN (jsDelivr) - Most stable!
        if (!hubLoaded) {
            try {
                console.log(`Worker ${WORKER_ID} | INFO | Fetching Hub Data from jsDelivr CDN...`);
                const cdnResp = await axios.get(`${CDN_HUB_URL}?cb=${Date.now()}`, { timeout: 30000 });
                if (cdnResp.data && cdnResp.data.stateUrls) {
                    stateUrls = cdnResp.data.stateUrls;
                    hubLoaded = true;
                    console.log(`Worker ${WORKER_ID} | INFO | Hub Data loaded from CDN.`);
                }
            } catch (e) { console.warn(`Worker ${WORKER_ID} | ⚠️ | CDN Hub Fetch Fail: ${e.message}`); }
        }

        // 3. Fallback to direct API
        if (!hubLoaded) {
            for (let retry = 1; retry <= 5; retry++) {
                try {
                    console.log(`Worker ${WORKER_ID} | INFO | Fetching Routing Table from API (Attempt ${retry}/5)...`);
                    const hubResp = await axios.get(`${MAIN_HUB_URL}?type=app_data&nocache=true`, { timeout: 30000 });
                    if (hubResp.data && hubResp.data.stateUrls) {
                        stateUrls = hubResp.data.stateUrls;
                        hubLoaded = true;
                        break;
                    }
                } catch (e) {
                    console.error(`Worker ${WORKER_ID} | ⚠️ | API Hub Fetch Failed: ${e.message}. Retrying in 10s...`);
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
        }

        if (!hubLoaded) {
            console.error(`Worker ${WORKER_ID} | [FATAL] | Could not load Hub Data after all attempts.`);
            await gracefulShutdown(true); return;
        }

        for (let sIdx = progress.stateIndex; sIdx < config.states.length; sIdx++) {
            // 🚀 DATA INTEGRITY: Flush any leftover data from the PREVIOUS state sheet
            // before we change the currentTargetUrl to the new state.
            if (sheetBuffer.length > 0 || firestoreBuffer.length > 0) {
                console.log(`Worker ${WORKER_ID} | INFO | Finalizing previous state data before transition...`);
                await flushBuffers();
            }

            const state = config.states[sIdx]; progress.stateIndex = sIdx;
            currentTargetUrl = stateUrls[state.name];
            if (!currentTargetUrl) continue;

            await syncFromSatellite(currentTargetUrl);

            let cities = WORKER_ID % 2 === 0 ? [...state.cities].reverse() : [...state.cities];
            for (let catIdx = progress.categoryIndex; catIdx < config.categories.length; catIdx++) {
                if (catIdx % TOTAL_WORKERS !== WORKER_ID) { progress.cityIndex = 0; continue; }

                const category = config.categories[catIdx]; progress.categoryIndex = catIdx;
                console.log(`\nWorker ${WORKER_ID} | [CAT START] | 📂 Starting Category ${catIdx + 1}/${config.categories.length}: ${category.name}\n`);
                for (let cIdx = progress.cityIndex; cIdx < cities.length; cIdx++) {
                    const city = cities[cIdx]; progress.cityIndex = cIdx;
                    console.log(`Worker ${WORKER_ID} | [CITY START] | 🏙️ Entering City: ${city} (City ${cIdx + 1}/${cities.length})`);

                    for (let subIdx = progress.subcategoryIndex; subIdx < category.sub.length; subIdx++) {
                        if (isStopping) break;

                        // 🚀 SESSION TIME CHECK
                        if (Date.now() - START_TIMESTAMP > MAX_SESSION_TIME_MS) {
                            console.log(`\nWorker ${WORKER_ID} | [TIMER] | Session limit reached. Syncing and restarting...`);
                            await gracefulShutdown(false); return;
                        }

                        const subcategory = category.sub[subIdx]; progress.subcategoryIndex = subIdx;

                        const wait = Math.floor(Math.random() * 10000) + 10000;
                        console.log(`\nWorker ${WORKER_ID} | WAIT | Resting for ${wait/1000}s...`);
                        await page.waitForTimeout(wait);

                        console.log(`Worker ${WORKER_ID} | SCAN | Sub-cat ${subIdx + 1}/${category.sub.length} | ${subcategory} in ${city}`);
                        const res = await scrapeCombination(page, city, state.name, category.id, subcategory);
                        if (res === -1) { await gracefulShutdown(true); return; }

                        console.log(`Worker ${WORKER_ID} | [FINISH] | Done with Sub-cat ${subIdx + 1}/${category.sub.length} (${subcategory}).`);
                        await saveProgress();
                    }
                    if (isStopping) break;
                    console.log(`\nWorker ${WORKER_ID} | [CITY COMPLETED] | 🏙️ Done with City ${cIdx + 1}/${cities.length} (${city}). Moving next...\n`);

                    // 🚀 FREQUENT SYNC: Flush data after each city is completed
                    if (sheetBuffer.length > 0 || firestoreBuffer.length > 0) await flushBuffers();

                    progress.subcategoryIndex = 0; // Reset sub-index for next city
                }
                if (isStopping) break;
                console.log(`\nWorker ${WORKER_ID} | [CAT COMPLETED] | 📂 Finished Category ${catIdx + 1}/${config.categories.length} (${category.name}). Switching next...\n`);
                progress.cityIndex = 0;
            }
            if (isStopping) break;
            progress.categoryIndex = 0;
        }

        // IF LOOP FINISHES NATURALLY, ALL STATES ARE DONE!
        console.log(`\n===============================================`);
        console.log(`🏁 MISSION ACCOMPLISHED: ALL STATES COMPLETED!`);
        console.log(`===============================================\n`);
        await gracefulShutdown(false);

    } catch (fatal) {
        console.error(`Worker ${WORKER_ID} | [FATAL] | Loop Error: ${fatal.message}`);
        await gracefulShutdown(true);
    }
}

runOrchestrator();
