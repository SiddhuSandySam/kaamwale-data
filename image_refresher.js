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
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const r = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: syncBatch });
                writeLog(`   ✅ Hub Response: ${JSON.stringify(r.data)}`);
                syncBatch = [];
                break;
            } catch (e) {
                writeLog(`   ⚠️ Sync Attempt ${attempt} Fail: ${e.message}`);
                if (e.message.includes('lock') || e.message.includes('timeout')) {
                    writeLog("      ⏳ Lock detected, sleeping 5s before retry...");
                    await new Promise(r => setTimeout(r, 5000));
                } else break;
            }
        }
    }
    if (doneBatch.length > 0) {
        writeLog(`🧹 Cleaning ${doneBatch.length} items from Queue...`);
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const r = await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch });
                writeLog(`   ✅ Queue Cleanup Response: ${JSON.stringify(r.data)}`);
                doneBatch = [];
                break;
            } catch (e) {
                writeLog(`   ⚠️ Cleanup Attempt ${attempt} Fail: ${e.message}`);
                if (e.message.includes('lock') || e.message.includes('timeout')) {
                    await new Promise(r => setTimeout(r, 5000));
                } else break;
            }
        }
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
        writeLog("   📸 Deep Scraping Portfolio (V198 - ANTI-PROFILE FIX)...");
        if (page.isClosed()) return [];

        // 1. 🔍 CHECK FOR TOP "PHOTOS" TAB
        const topTab = await page.$('button[data-value="Photos"], button[aria-label^="Photos"], a[aria-label^="Photos"]');
        let galleryOpened = false;

        if (topTab && await topTab.isVisible()) {
            writeLog("      ✅ Found Top Photos Tab. Clicking...");
            await topTab.click({ force: true });
            await page.waitForTimeout(5000);
            galleryOpened = true;
        }

        // 2. 🖼️ CLICK MAIN IMAGE (Top of Profile) if Tab not found
        if (!galleryOpened) {
            const mainImg = await page.$('button[aria-label^="Photo of"], img[src*="googleusercontent.com/p/"]');
            if (mainImg && await mainImg.isVisible()) {
                writeLog("      ✅ Found Main Image. Clicking to open gallery...");
                await mainImg.click({ force: true });
                await page.waitForTimeout(5000);
                galleryOpened = true;
            }
        }

        // 3. ⏬ TARGETED SCROLL & SECTION TRIGGERS
        if (!galleryOpened) {
            writeLog("      ⏬ Gallery not opened yet. Performing targeted scroll...");
            for (let i = 0; i < 4; i++) {
                const photosHeading = await page.$('h2:has-text("Photos"), h2:has-text("Photos & videos")');
                if (photosHeading && await photosHeading.isVisible()) {
                    writeLog("      📍 Reached Photos section.");
                    break;
                }
                await page.mouse.wheel(0, 800);
                await page.keyboard.press('PageDown');
                await page.waitForTimeout(1000);
            }

            const sectionTriggers = [
                'button[aria-label="All"]',
                'div[aria-label="All"]',
                'button:has-text("All")',
                '.m18v9e img',
                '.uEubGf img'
            ];

            for (let sel of sectionTriggers) {
                const trigger = await page.$(sel);
                if (trigger && await trigger.isVisible()) {
                    writeLog(`      ✅ Found Section Trigger: ${sel}. Clicking...`);
                    await trigger.click({ force: true });
                    await page.waitForTimeout(5000);
                    galleryOpened = true;
                    break;
                }
            }
        }

        const allUrls = new Set();
        const loopCount = galleryOpened ? 25 : 8;

        writeLog(`      📑 Extraction Loop (${loopCount} iterations) | Gallery Mode: ${galleryOpened}...`);
        for (let i = 0; i < loopCount; i++) {
            if (page.isClosed()) break;

            const batch = await page.evaluate((isGallery) => {
                const found = [];
                // If in gallery mode, limit search to the gallery container to avoid reviewer icons
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
                        // 🛡️ STRICT FILTERING: Exclude profile pictures (/a/ or /a-/)
                        // Business photos usually have /p/ (Place) or /video/
                        const isProfile = src.includes('/a/') || src.includes('/a-/') || src.includes('=s32') || src.includes('=s64');
                        const isPhoto = src.includes('/p/') || src.includes('/video/');

                        if (isProfile && !isPhoto) return; // Skip obvious profiles

                        // Check if parent is likely a review author icon
                        let parent = el.parentElement;
                        let isReviewIcon = false;
                        for (let j = 0; j < 4; j++) {
                            if (!parent) break;
                            const aria = (parent.getAttribute('aria-label') || "").toLowerCase();
                            if (aria.includes('photo of') && !aria.includes('business') && !aria.includes('owner')) {
                                // Maps photos often have "Photo of BusinessName"
                                // Reviewer icons often have "Photo of ReviewerName"
                            }
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

            if (galleryOpened) {
                await page.evaluate(() => {
                    const scrollable = document.querySelector('.m6x62c-v77d8b-view-container, .DxyBCb, div[role="grid"]');
                    if (scrollable) scrollable.scrollBy(0, 1500);
                    else window.scrollBy(0, 800);
                });
            } else {
                await page.mouse.wheel(0, 600);
            }
            await page.waitForTimeout(1200);
        }

        const portfolio = Array.from(allUrls).filter(u => !u.includes('mapslogo')).slice(0, 45);

        if (galleryOpened) {
            writeLog("      🔙 Closing Gallery...");
            const closeSelectors = ['button[aria-label="Back"]', 'button[aria-label="Close"]', '.VfPpkd-icon-LgbsSe'];
            for (let sel of closeSelectors) {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) { await btn.click(); await page.waitForTimeout(1000); break; }
            }
        }

        writeLog(`   🖼️ Result: ${portfolio.length} high-res images extracted (Filtered).`);
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
