const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 HYBRID AUTO-REFRESHER MULTI-WORKER (V166 - SYNCED WITH IMAGE_REFRESHER)
 * Purpose: Process RefreshQueue with Hybrid Discovery logic.
 * Features: processAddressDiscovery, Multi-profile scanning, Pro Logging.
 */

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = { states: [] };
if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch (e) {}
}

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    const LOG_FILE = path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`);
    fs.appendFileSync(LOG_FILE, logMsg);
}

function processAddressDiscovery(fullAddress, state) {
    try {
        const parts = fullAddress.split(',').map(p => p.trim());
        const JUNK = ['building', 'shop', 'floor', 'plot', 'near', 'road', 'sector', 'street'];
        for (let i = 0; i < Math.min(parts.length, 5); i++) {
            const raw = parts[i];
            const lower = raw.toLowerCase();
            if (raw.includes('+') || JUNK.some(k => lower.includes(k)) || raw.length < 3) continue;
            const clean = raw.replace(/[0-9]/g, '').trim();
            if (clean.length < 3) continue;
            const isExisting = config.states.some(s =>
                s.name.toLowerCase().includes(state.toLowerCase()) &&
                s.cities.some(c => c.toLowerCase() === clean.toLowerCase())
            );
            if (!isExisting) {
                const discoveryFile = path.join(__dirname, `discovered_W${WORKER_ID}.json`);
                let discoveries = {};
                if (fs.existsSync(discoveryFile)) { try { discoveries = JSON.parse(fs.readFileSync(discoveryFile)); } catch (e) {} }
                const key = `${state}|${clean}`;
                discoveries[key] = (discoveries[key] || 0) + 1;
                fs.writeFileSync(discoveryFile, JSON.stringify(discoveries, null, 2));
                writeLog(`      🏙️ NEW AREA DISCOVERED: ${clean} in ${state}`);
            }
        }
    } catch (e) {}
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

async function extractPortfolio(page) {
    try {
        if (page.isClosed()) return [];
        writeLog("      📸 Scraping Portfolio...");

        await page.evaluate(async () => {
            const panel = document.querySelector('div[role="main"], div[role="dialog"]');
            if (panel) { panel.scrollBy(0, 600); await new Promise(r => setTimeout(r, 400)); }
        });

        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
            writeLog("      📂 Opening Gallery...");
            await photoBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(5000);

            for (let i = 0; i < 8; i++) {
                await page.mouse.wheel(0, 1500);
                await page.waitForTimeout(800);
            }
            await page.waitForTimeout(2000);
        }

        return await page.evaluate(() => {
            const links = new Set();
            const processUrl = (src) => {
                if (!src || !src.includes('googleusercontent.com') || src.includes('base64')) return;
                if (src.includes('/a/') || src.includes('/a-/') || src.includes('shared-v1')) return;
                let base = src.split('=')[0];
                if (base.includes('/s')) base = base.split('/s')[0];
                links.add(base + '=s1000');
            };

            document.querySelectorAll('*').forEach(el => {
                if (el.tagName === 'IMG') processUrl(el.src);
                const style = el.getAttribute('style') || '';
                if (style.includes('background-image')) {
                    const match = style.match(/url\(["']?([^"']+)["']?\)/);
                    if (match) processUrl(match[1]);
                }
                processUrl(el.getAttribute('data-src'));
                processUrl(el.getAttribute('data-url'));
            });
            return Array.from(links).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function processProfile(page, task, dbPhone, nameRaw, targetCity, targetCat, targetSub) {
    try {
        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
        const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        const addrRaw = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanAddr = addrRaw.replace('\n', '').replace('', '').trim();

        if (cleanAddr !== "N/A" && !cleanAddr.toLowerCase().includes(task.state.toLowerCase())) {
            writeLog(`      🛑 SKIP: State mismatch (Detected: ${cleanAddr})`);
            return { status: "SKIP_STATE" };
        }

        const urlCoords = page.url().match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        let lat = urlCoords ? parseFloat(urlCoords[1]) : 0;
        let lon = urlCoords ? parseFloat(urlCoords[2]) : 0;
        writeLog(`      📍 Coordinates: ${lat}, ${lon}`);

        if (isMatch) {
            writeLog(`      ✅ TARGET MATCH! (Phone: ${cleanMapsPhone})`);
            const keywords = await page.evaluate(() => {
                const cat = document.querySelector('button[jsaction="pane.rating.category"]')?.innerText || "";
                const tags = Array.from(document.querySelectorAll('.YR19ub')).map(el => el.innerText).join(",");
                return (cat + "," + tags).split(',').map(s => s.trim()).filter(s => s.length > 2).join(",");
            });
            const portfolio = await extractPortfolio(page);

            return {
                status: "UPDATE",
                data: {
                    id: task.id,
                    state: task.state,
                    profilePhotoUrl: portfolio[0] ? portfolio[0].replace('=s1000', '=w500-h500-k-no') : "",
                    portfolioUrls: portfolio.join(','),
                    searchKeywords: keywords || nameRaw
                }
            };
        } else if (cleanMapsPhone !== "NOT_FOUND" && cleanMapsPhone.length === 10 && lat !== 0) {
            writeLog(`      💡 DISCOVERY! Found ${nameRaw} (${cleanMapsPhone})`);
            const keywords = await page.evaluate(() => {
                const cat = document.querySelector('button[jsaction="pane.rating.category"]')?.innerText || "";
                const tags = Array.from(document.querySelectorAll('.YR19ub')).map(el => el.innerText).join(",");
                return (cat + "," + tags).split(',').map(s => s.trim()).filter(s => s.length > 2).join(",");
            });
            const portfolio = await extractPortfolio(page);

            if (portfolio.length > 0) {
                // Discover city/area name
                processAddressDiscovery(cleanAddr, task.state);

                return {
                    status: "DISCOVERY",
                    data: {
                        id: `shadow_${cleanMapsPhone}`,
                        businessName: nameRaw,
                        primaryCategoryId: targetCat,
                        subcategory: targetSub,
                        experienceYears: Math.floor(Math.random() * 5) + 2,
                        serviceMode: "Local",
                        city: targetCity, locality: targetCity, state: task.state,
                        startingPrice: 0, priceUnit: "Discuss on Call",
                        whatsappNumber: cleanMapsPhone, callNumber: cleanMapsPhone,
                        aboutDescription: `Professional ${targetSub} services in ${targetCity}.`,
                        isApproved: true, isVerified: false, rating: 0.0,
                        profilePhotoUrl: portfolio[0] ? portfolio[0].replace('=s1000', '=w500-h500-k-no') : "",
                        recommendationCount: 0, portfolioUrls: portfolio.join(','),
                        searchKeywords: keywords || nameRaw, lastSeen: Date.now(),
                        callCount: 0, fullAddress: cleanAddr, isNumberHidden: false,
                        referredBy: "AUTO_REFRESHER_MULTI_V166", latitude: lat, longitude: lon
                    }
                };
            }
        }
        return { status: "NONE" };
    } catch (e) { writeLog(`      ⚠️ Profile Error: ${e.message}`); return { status: "ERROR" }; }
}

async function runWorker() {
    writeLog(`🚀 Hybrid Auto-Refresher Starting... (Worker: ${WORKER_ID})`);
    try {
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];
        if (allTasks.length === 0) return writeLog("✅ Queue Empty.");

        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);
        writeLog(`📋 Task Queue: ${myTasks.length} assigned.`);

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        for (const task of myTasks) {
            // 🚀 STRICT CHECK: Skip if new mandatory fields are missing
            if (!task.city || !task.categoryId || !task.subcategory) {
                writeLog(`⚠️ SKIP [OLD DATA]: Task ${task.id} is missing mandatory fields (City/Cat/Sub).`);
                continue;
            }

            const dbPhone = String(task.id).replace('shadow_', '');
            const targetCity = task.city || "Local";
            const targetCat = task.categoryId || "cat_home";
            const targetSub = task.subcategory || "";

            writeLog(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            writeLog(`🔍 TASK: ${task.name} | Phone: ${dbPhone}`);

            const searchQuery = targetSub ? `${targetSub} in ${targetCity}, ${task.state}` : `${task.name}, ${task.city}`;
            writeLog(`🔎 Search Query: ${searchQuery}`);

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);

                const status = await Promise.race([
                    page.waitForSelector('a.hfpxzc', { timeout: 15000 }).then(() => "LIST").catch(() => null),
                    page.waitForSelector('h1.DUwDvf', { timeout: 15000 }).then(() => "SINGLE").catch(() => null)
                ]);

                let targetFound = false;

                if (status === "SINGLE") {
                    writeLog(`📋 Single Profile detected.`);
                    const name = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "Unknown");
                    const res = await processProfile(page, task, dbPhone, name, targetCity, targetCat, targetSub);
                    if (res.status === "UPDATE") {
                        const updResp = await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: [res.data] });
                        writeLog(`      📡 Update Sync: ${updResp.data}`);
                        await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                        targetFound = true;
                    }
                } else if (status === "LIST") {
                    writeLog(`📋 List View detected. Scanning top 12...`);
                    for (let i = 0; i < 12; i++) {
                        const listings = await page.$$('a.hfpxzc');
                        if (i >= listings.length) break;
                        const listing = listings[i];
                        const nameRaw = await listing.getAttribute('aria-label').catch(() => "Unknown");

                        writeLog(`   [${i+1}] Checking: ${nameRaw}`);
                        await listing.click({ force: true });

                        let loaded = false;
                        for (let r = 0; r < 8; r++) {
                            const title = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "");
                            if (title.toLowerCase().includes(nameRaw.toLowerCase().substring(0, 3))) { loaded = true; break; }
                            await page.waitForTimeout(1000);
                        }
                        if (!loaded) continue;

                        const res = await processProfile(page, task, dbPhone, nameRaw, targetCity, targetCat, targetSub);
                        if (res.status === "UPDATE") {
                            const updResp = await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: [res.data] });
                            writeLog(`      📡 Update Sync: ${updResp.data}`);
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                            targetFound = true;
                        } else if (res.status === "DISCOVERY") {
                            const dResp = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: [res.data] });
                            writeLog(`      📡 Discovery Sync: ${dResp.data}`);
                        }

                        const backBtn = await page.$('button[aria-label*="Back"], button[aria-label*="मागे"]');
                        if (backBtn) { await backBtn.click(); await page.waitForTimeout(2000); }

                        if (targetFound && i > 5) break;
                    }
                }

                if (!targetFound) {
                    writeLog(`❌ Target not found in search.`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                }

            } catch (err) { writeLog(`❌ Task Error: ${err.message}`); }
        }

        await browser.close();
        writeLog("\n🏁 HYBRID AUTO-REFRESHER FINISHED.");
    } catch (e) { writeLog(`🔥 Fatal System Error: ${e.message}`); }
}

runWorker();
