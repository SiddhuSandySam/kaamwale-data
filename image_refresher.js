const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 HYBRID IMAGE REFRESHER & REPAIR (V192 - ULTRA-HARD EXTRACTION)
 * 🛡️ STRICT: processAddressDiscovery (Full Junk List Restored)
 * 🛡️ STRICT: FULL 31 COLUMNS (Exact Multi-Worker Structure)
 * 📊 VERBOSE: Deep Portfolio Scroll (12x) with forced 1000px resolution.
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
    writeLog("⚡ STARTING BATCH FLUSH (10 Leads Mode)...");
    if (syncBatch.length > 0) {
        writeLog(`📤 Syncing ${syncBatch.length} leads to Sheet (FULL 31-FIELD MODE)...`);
        try {
            const r = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: syncBatch });
            writeLog(`   ✅ Hub Response: ${JSON.stringify(r.data)}`);
            syncBatch = [];
        } catch (e) { writeLog(`   ❌ Sync Error: ${e.message}`); }
    }
    if (doneBatch.length > 0) {
        writeLog(`🧹 Cleaning ${doneBatch.length} items from Queue...`);
        try {
            const r = await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch });
            writeLog(`   ✅ Queue Cleanup Response: ${JSON.stringify(r.data)}`);
            doneBatch = [];
        } catch (e) { writeLog(`   ❌ Queue Cleanup Error: ${e.message}`); }
    }
    writeLog("⚡ BATCH FLUSH COMPLETED.");
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

function processAddressDiscovery(fullAddress, state) {
    try {
        if (!fullAddress || fullAddress === "N/A") return;
        writeLog(`   🏙️ Checking Area Discovery for: ${fullAddress}`);
        const JUNK_KEYWORDS = ['building', 'shop', 'floor', 'plot', 'opp', 'near', 'room', 'flat', 'house', 'no', 'number', 'block', 'phase', 'lane', 'industrial', 'highway', 'road', 'rd', 'marg', 'st', 'society', 'apt', 'apartment', 'villa', 'tower', 'beside', 'behind', 'temple', 'hospital', 'school', 'church', 'masjid', 'gate', 'mall', 'market', 'complex', 'center', 'centre', 'chowk', 'circle', 'bypass', 'yard', 'ward', 'street', 'gali', 'sector', 'khasra', 'mandir', 'सेक्टर', 'गावात', 'road'];
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
                    const discoveryFile = path.join(__dirname, `discovered_W${WORKER_ID}.json`);
                    let discoveries = {};
                    if (fs.existsSync(discoveryFile)) { try { discoveries = JSON.parse(fs.readFileSync(discoveryFile)); } catch (e) {} }
                    const key = `${state}|${cleanName}`;
                    discoveries[key] = (discoveries[key] || 0) + 1;
                    fs.writeFileSync(discoveryFile, JSON.stringify(discoveries, null, 2));
                    writeLog(`      🌟 DISCOVERED NEW AREA: ${cleanName} in ${state}`);
                }
            }
        }
    } catch (e) { writeLog(`   ⚠️ Discovery Error: ${e.message}`); }
}

async function extractPortfolio(page) {
    try {
        writeLog("   📸 Deep Scraping Portfolio (Incremental Extraction Mode)...");
        if (page.isClosed()) return [];

        // 1. 📂 OPEN PHOTO GRID (Targeting the actual Photos button/tab)
        const photoTrigger = await page.$('button[data-value="Photos"], button[aria-label^="Photos"], .m6x62c');
        let galleryOpened = false;
        if (photoTrigger) {
            writeLog("      ✅ Opening Photo Gallery Grid...");
            await photoTrigger.click({ force: true });
            await page.waitForTimeout(5000);
            galleryOpened = true;
        }

        const allUrls = new Set();

        for (let i = 0; i < 15; i++) {
            if (page.isClosed()) break;

            const batch = await page.evaluate(() => {
                const found = [];
                // Target the specific gallery containers
                const container = document.querySelector('.m6x62c-v77d8b-view-container, .DxyBCb, div[role="grid"]');
                const target = container || document;

                target.querySelectorAll('img').forEach(img => {
                    let src = img.src || img.getAttribute('src') || img.dataset.src || '';
                    if (src.includes('googleusercontent.com') && !src.includes('base64') && !src.includes('/a/')) {
                        found.push(src.split('=')[0].split('/s')[0] + '=s1000');
                    }
                });
                return found;
            });

            batch.forEach(url => allUrls.add(url));

            // 📜 SCROLL THE ACTUAL GRID
            const scrolled = await page.evaluate(() => {
                const scrollable = document.querySelector('.m6x62c-v77d8b-view-container, .DxyBCb, div[role="main"], div[tabindex="0"]');
                if (scrollable) {
                    scrollable.scrollBy(0, 1200);
                    return true;
                }
                return false;
            });

            if (!scrolled) {
                // Fallback: scroll the whole panel
                await page.mouse.wheel(0, 1200);
            }
            await page.waitForTimeout(1000);
        }

        const portfolio = Array.from(allUrls).filter(u => !u.includes('mapslogo')).slice(0, 45);

        if (galleryOpened) {
            const backBtn = await page.$('button[aria-label="Back"], .VfPpkd-icon-LgbsSe');
            if (backBtn) { await backBtn.click(); await page.waitForTimeout(1000); }
        }

        writeLog(`   🖼️ Found ${portfolio.length} total high-res images.`);
        return portfolio;
    } catch (e) { writeLog(`   ⚠️ Portfolio Error: ${e.message}`); return []; }
}

async function processProfile(page, task, dbPhone, nameRaw) {
    try {
        writeLog(`   🔍 Processing Profile: ${nameRaw}`);
        const isClosed = await page.evaluate(() => document.body.innerText.toLowerCase().includes('temporarily closed'));
        if (isClosed && nameRaw.toLowerCase().includes(task.name.toLowerCase().substring(0,3))) {
            writeLog(`   🚫 DEACTIVATING: ${nameRaw} is Closed.`);
            summary.deactivated.push(`${nameRaw} (${dbPhone})`);
            await axios.post(HUB_URL, { type: "DELETE_ENTRIES", id: task.id });
            return true;
        }

        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
        writeLog(`   📱 Maps Phone: ${cleanMapsPhone} | Expected: ${dbPhone}`);

        const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        const url = page.url();
        let lat = 0, lon = 0;
        const pm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (pm) { lat = parseFloat(pm[1]); lon = parseFloat(pm[2]); writeLog(`   📍 GPS Coordinates: ${lat}, ${lon}`); }

        const addrRaw = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanAddr = addrRaw.replace('\n', '').replace('', '').trim();
        if (cleanAddr === "N/A" || !cleanAddr) { writeLog("   🛑 Skip: No valid address found."); return false; }

        const portfolio = await extractPortfolio(page);
        if (portfolio.length === 0) { writeLog("   🛑 Skip: No portfolio images extracted."); return false; }

        const provider = {
            id: isMatch ? task.id : `shadow_${cleanMapsPhone}`,
            businessName: nameRaw, primaryCategoryId: task.categoryId, subcategory: task.subcategory,
            experienceYears: Math.floor(Math.random() * 5) + 3, serviceMode: "Local",
            city: task.city, locality: task.city, state: task.state,
            startingPrice: 0, priceUnit: "Discuss on Call",
            whatsappNumber: cleanMapsPhone, callNumber: cleanMapsPhone,
            aboutDescription: `Professional ${task.subcategory} services available in ${task.city}. High-quality work guaranteed by local experts.`,
            isApproved: true, isVerified: false, rating: 0.0,
            profilePhotoUrl: portfolio[0] ? portfolio[0].split('=')[0] + '=w500-h500-k-no' : "",
            recommendationCount: 0, portfolioUrls: portfolio,
            searchKeywords: [nameRaw, task.city, task.subcategory, task.state],
            lastSeen: Date.now(), callCount: 0, fullAddress: cleanAddr,
            isNumberHidden: false, referredBy: "V192_IRON_CLAD",
            referralBonusPaid: false, fcmToken: "", notificationsEnabled: true,
            latitude: lat, longitude: lon
        };

        processAddressDiscovery(cleanAddr, task.state);
        syncBatch.push(provider);
        writeLog(`   📦 Added to Batch (${syncBatch.length}/10) | Type: ${isMatch ? "REPAIR" : "DISCOVERY"}`);
        if (isMatch) summary.updated.push(`${nameRaw} (${dbPhone})`);
        else summary.discovered.push(`${nameRaw} (${cleanMapsPhone})`);
        return true;
    } catch (e) { writeLog(`   ⚠️ Profile Error: ${e.message}`); return false; }
}

async function runWorker() {
    writeLog(`🚀 Hybrid Refresher V192 Starting (ULTRA-HARD EXTRACTION)`);
    try {
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];
        if (allTasks.length === 0) return writeLog("✅ Queue Empty. Exiting.");
        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);
        writeLog(`📋 My Tasks: ${myTasks.length} assigned.`);

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
            } catch (err) { writeLog(`❌ Loop Error: ${err.message}`); }
        }
        await flushBatches();
        await browser.close();
        writeLog("\n" + "=".repeat(50));
        writeLog("📊 FINAL SUMMARY REPORT (V192)");
        writeLog(`✅ UPDATED: ${summary.updated.length}\n🌟 DISCOVERED: ${summary.discovered.length}`);
        writeLog("=".repeat(50));
    } catch (e) { writeLog(`🔥 Fatal Error: ${e.message}`); }
}
runWorker();
