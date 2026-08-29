const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 HYBRID IMAGE REFRESHER & DATA REPAIR (V169 - SMART FILTER & SUMMARY)
 * Purpose: Refresh, Repair, and Deactivate Closed leads.
 */

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, 'config.json');

const summary = { updated: [], discovered: [], deactivated: [] };

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    const LOG_FILE = path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`);
    fs.appendFileSync(LOG_FILE, logMsg);
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
        await page.evaluate(async () => {
            const panel = document.querySelector('div[role="main"], div[role="dialog"]');
            if (panel) { panel.scrollBy(0, 600); await new Promise(r => setTimeout(r, 400)); }
        });
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
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
            document.querySelectorAll('img').forEach(el => {
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    let base = el.src.split('=')[0];
                    if (base.includes('/s')) base = base.split('/s')[0];
                    links.add(base + '=s1000');
                }
            });
            return Array.from(links).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function processProfile(page, task, dbPhone, nameRaw, targetCity, targetCat, targetSub) {
    try {
        // 🚀 CHECK FOR TEMPORARILY CLOSED
        const isClosed = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();
            return text.includes('temporarily closed') || text.includes('अस्थायी रूप से बंद');
        });

        if (isClosed) {
            writeLog(`🚫 DEACTIVATING: ${nameRaw} is Temporarily Closed.`);
            await axios.post(HUB_URL, { type: "DELETE_ENTRIES", id: task.id });
            summary.deactivated.push(`${nameRaw} (${dbPhone})`);
            return { status: "DEACTIVATED" };
        }

        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
        const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        const url = page.url();
        let lat = 0, lon = 0;
        const preciseMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        const fallbackMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (preciseMatch) { lat = parseFloat(preciseMatch[1]); lon = parseFloat(preciseMatch[2]); }
        else if (fallbackMatch) { lat = parseFloat(fallbackMatch[1]); lon = parseFloat(fallbackMatch[2]); }

        const keywords = await page.evaluate(() => {
            const cat = document.querySelector('button[jsaction="pane.rating.category"]')?.innerText || "";
            const tags = Array.from(document.querySelectorAll('.YR19ub')).map(el => el.innerText).join(",");
            return (cat + "," + tags).split(',').map(s => s.trim()).filter(s => s.length > 2).join(",");
        });
        const portfolio = await extractPortfolio(page);

        if (isMatch) {
            summary.updated.push(`${nameRaw} (${dbPhone})`);
            return {
                status: "UPDATE",
                data: {
                    id: task.id, state: task.state,
                    profilePhotoUrl: portfolio[0] ? portfolio[0].replace('=s1000', '=w500-h500-k-no') : "",
                    portfolioUrls: portfolio.join(','),
                    searchKeywords: keywords || nameRaw,
                    primaryCategoryId: targetCat, subcategory: targetSub,
                    latitude: lat, longitude: lon, city: targetCity, locality: targetCity,
                    experienceYears: Math.floor(Math.random() * 5) + 3,
                    serviceMode: "Local", startingPrice: 0, priceUnit: "Discuss on Call"
                }
            };
        } else if (cleanMapsPhone !== "NOT_FOUND" && cleanMapsPhone.length === 10 && lat !== 0 && portfolio.length > 0) {
            summary.discovered.push(`${nameRaw} (${cleanMapsPhone})`);
            return {
                status: "DISCOVERY",
                data: {
                    id: `shadow_${cleanMapsPhone}`, businessName: nameRaw,
                    primaryCategoryId: targetCat, subcategory: targetSub,
                    experienceYears: Math.floor(Math.random() * 5) + 2, serviceMode: "Local",
                    city: targetCity, locality: targetCity, state: task.state,
                    startingPrice: 0, priceUnit: "Discuss on Call",
                    whatsappNumber: cleanMapsPhone, callNumber: cleanMapsPhone,
                    isApproved: true, isVerified: false, rating: 0.0,
                    profilePhotoUrl: portfolio[0] ? portfolio[0].replace('=s1000', '=w500-h500-k-no') : "",
                    portfolioUrls: portfolio.join(','),
                    searchKeywords: keywords || nameRaw, lastSeen: Date.now(),
                    latitude: lat, longitude: lon, referredBy: "HYBRID_REFRESHER_V169"
                }
            };
        }
        return { status: "NONE" };
    } catch (e) { return { status: "ERROR" }; }
}

async function runWorker() {
    writeLog(`🚀 Hybrid Refresher Starting (Worker: ${WORKER_ID})`);
    try {
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];
        if (allTasks.length === 0) return writeLog("✅ Queue Empty.");
        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);

        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        for (const task of myTasks) {
            if (!task.city || !task.categoryId || !task.subcategory) continue;
            const dbPhone = String(task.id).replace('shadow_', '');
            const searchQuery = `${task.subcategory} in ${task.city}, ${task.state}`;

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);
                const status = await Promise.race([
                    page.waitForSelector('a.hfpxzc', { timeout: 15000 }).then(() => "LIST").catch(() => null),
                    page.waitForSelector('h1.DUwDvf', { timeout: 15000 }).then(() => "SINGLE").catch(() => null)
                ]);

                let targetFound = false;
                if (status === "SINGLE") {
                    const name = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "Unknown");
                    const res = await processProfile(page, task, dbPhone, name, task.city, task.categoryId, task.subcategory);
                    if (res.status === "UPDATE" || res.status === "DEACTIVATED") {
                        if (res.status === "UPDATE") await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: [res.data] });
                        await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                        targetFound = true;
                    }
                } else if (status === "LIST") {
                    const listings = await page.$$('a.hfpxzc');
                    for (let i = 0; i < Math.min(listings.length, 12); i++) {
                        const currentListings = await page.$$('a.hfpxzc');
                        if (i >= currentListings.length) break;
                        const listing = currentListings[i];
                        const nameRaw = await listing.getAttribute('aria-label').catch(() => "Unknown");

                        // Check for 'Temporarily closed' in list view text
                        const isClosedInList = await listing.evaluate(el => {
                            const parent = el.closest('.Nv2Ybe');
                            return parent ? parent.innerText.toLowerCase().includes('temporarily closed') : false;
                        });

                        if (isClosedInList && nameRaw.toLowerCase().includes(task.name.toLowerCase().substring(0,5))) {
                            writeLog(`🚫 DEACTIVATING (List View): ${nameRaw}`);
                            await axios.post(HUB_URL, { type: "DELETE_ENTRIES", id: task.id });
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                            summary.deactivated.push(`${nameRaw} (${dbPhone})`);
                            targetFound = true; break;
                        }

                        await listing.click({ force: true });
                        await page.waitForTimeout(3000);
                        const res = await processProfile(page, task, dbPhone, nameRaw, task.city, task.categoryId, task.subcategory);
                        if (res.status === "UPDATE" || res.status === "DEACTIVATED") {
                            if (res.status === "UPDATE") await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: [res.data] });
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                            targetFound = true; break;
                        } else if (res.status === "DISCOVERY") {
                            await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: [res.data] });
                        }
                        const backBtn = await page.$('button[aria-label*="Back"], button[aria-label*="मागे"]');
                        if (backBtn) { await backBtn.click(); await page.waitForTimeout(2000); }
                    }
                }
                if (!targetFound) await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
            } catch (err) {}
        }
        await browser.close();

        console.log("\n" + "=".repeat(50));
        console.log("📊 EXECUTION SUMMARY REPORT");
        console.log("=".repeat(50));
        console.log(`✅ UPDATED (${summary.updated.length}):`);
        summary.updated.forEach(s => console.log(`   - ${s}`));
        console.log(`🌟 DISCOVERED (${summary.discovered.length}):`);
        summary.discovered.forEach(s => console.log(`   - ${s}`));
        console.log(`🚫 DEACTIVATED (${summary.deactivated.length}):`);
        summary.deactivated.forEach(s => console.log(`   - ${s}`));
        console.log("=".repeat(50) + "\n");

    } catch (e) { writeLog(`🔥 Fatal Error: ${e.message}`); }
}
runWorker();
