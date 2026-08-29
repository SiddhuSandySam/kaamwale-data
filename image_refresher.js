const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🚀 HYBRID IMAGE REFRESHER & REPAIR (V172 - BATCH 10 ENGINE)
 * Purpose: Refresh, Repair, and Deactivate Closed leads in Batches of 10.
 */

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, 'config.json');

const summary = { updated: [], discovered: [], deactivated: [] };
let updateBatch = [];
let discoveryBatch = [];
let doneBatch = [];

let config = { states: [] };
if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch (e) {}
}

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[W${WORKER_ID}] ${msg}`);
    fs.appendFileSync(path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`), `[${timestamp}] ${msg}\n`);
}

async function flushBatches() {
    if (updateBatch.length > 0) {
        writeLog(`📤 Flushing ${updateBatch.length} Updates to Hub...`);
        const r = await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: updateBatch });
        writeLog(`   📡 Update Response: ${r.data}`);
        updateBatch = [];
    }
    if (discoveryBatch.length > 0) {
        writeLog(`🌟 Flushing ${discoveryBatch.length} Discoveries to Hub...`);
        const r = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: discoveryBatch });
        writeLog(`   📡 Discovery Response: ${r.data}`);
        discoveryBatch = [];
    }
    if (doneBatch.length > 0) {
        writeLog(`🧹 Cleaning ${doneBatch.length} items from Queue...`);
        await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: doneBatch });
        doneBatch = [];
    }
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
        await page.evaluate(async () => {
            const panel = document.querySelector('div[role="main"], div[role="dialog"]');
            if (panel) { panel.scrollBy(0, 600); await new Promise(r => setTimeout(r, 400)); }
        });
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
            await photoBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(5000);
            for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(800); }
            await page.waitForTimeout(2000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    let base = el.src.split('=')[0].split('/s')[0];
                    links.add(base + '=s1000');
                }
            });
            return Array.from(links).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`🚀 Batch Refresher V172 Starting (Headless: FALSE)`);
    try {
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];
        if (allTasks.length === 0) return writeLog("✅ Queue Empty.");
        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);

        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();

        for (const task of myTasks) {
            if (!task.city || !task.categoryId || !task.subcategory) {
                doneBatch.push(task.id); continue;
            }
            const dbPhone = String(task.id).replace('shadow_', '');
            const searchQuery = `${task.subcategory} in ${task.city}, ${task.state}`;

            writeLog(`🔍 SEARCH: ${searchQuery} for ${task.name}`);
            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);
                const status = await Promise.race([
                    page.waitForSelector('a.hfpxzc', { timeout: 15000 }).then(() => "LIST").catch(() => null),
                    page.waitForSelector('h1.DUwDvf', { timeout: 15000 }).then(() => "SINGLE").catch(() => null)
                ]);

                let found = false;
                if (status === "SINGLE") {
                    const name = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "Unknown");
                    const res = await processProfile(page, task, dbPhone, name);
                    if (res) found = true;
                } else if (status === "LIST") {
                    const listings = await page.$$('a.hfpxzc');
                    for (let i = 0; i < Math.min(listings.length, 8); i++) {
                        const items = await page.$$('a.hfpxzc');
                        if (!items[i]) break;
                        const nameRaw = await items[i].getAttribute('aria-label').catch(() => "Unknown");
                        await items[i].click({ force: true });
                        await page.waitForTimeout(3000);
                        const res = await processProfile(page, task, dbPhone, nameRaw);
                        if (res) { found = true; break; }
                        const back = await page.$('button[aria-label*="Back"], button[aria-label*="मागे"]');
                        if (back) { await back.click(); await page.waitForTimeout(1500); }
                    }
                }

                doneBatch.push(task.id);
                if (updateBatch.length >= 10 || discoveryBatch.length >= 10 || doneBatch.length >= 10) await flushBatches();

            } catch (err) { writeLog(`❌ Task Error: ${err.message}`); }
        }
        await flushBatches();
        await browser.close();

        console.log("\n📊 FINAL SUMMARY REPORT (V172)");
        console.log(`✅ UPDATED: ${summary.updated.length}\n🌟 DISCOVERED: ${summary.discovered.length}\n🚫 DEACTIVATED: ${summary.deactivated.length}`);
    } catch (e) { writeLog(`🔥 Error: ${e.message}`); }
}

async function processProfile(page, task, dbPhone, nameRaw) {
    try {
        const isClosed = await page.evaluate(() => document.body.innerText.toLowerCase().includes('temporarily closed'));
        if (isClosed && nameRaw.toLowerCase().includes(task.name.toLowerCase().substring(0,3))) {
            await axios.post(HUB_URL, { type: "DELETE_ENTRIES", id: task.id });
            summary.deactivated.push(`${nameRaw} (${dbPhone})`);
            return true;
        }

        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
        const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        const url = page.url();
        let lat = 0, lon = 0;
        const pm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        const fm = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (pm) { lat = parseFloat(pm[1]); lon = parseFloat(pm[2]); }
        else if (fm) { lat = parseFloat(fm[1]); lon = parseFloat(fm[2]); }

        const addrRaw = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const cleanAddr = addrRaw.replace('\n', '').replace('', '').trim();
        const portfolio = await extractPortfolio(page);

        if (isMatch) {
            writeLog(`✅ MATCH: Repairing ${nameRaw}...`);
            processAddressDiscovery(cleanAddr, task.state);
            updateBatch.push({
                id: task.id, state: task.state, profilePhotoUrl: portfolio[0] || "", portfolioUrls: portfolio.join(','),
                primaryCategoryId: task.categoryId, subcategory: task.subcategory,
                latitude: lat, longitude: lon, fullAddress: cleanAddr, city: task.city, locality: task.city,
                aboutDescription: `Professional ${task.subcategory} services in ${task.city}. High-quality work guaranteed.`
            });
            summary.updated.push(`${nameRaw} (${dbPhone})`);
            return true;
        } else if (cleanMapsPhone.length === 10 && lat !== 0 && portfolio.length > 0) {
            discoveryBatch.push({
                id: `shadow_${cleanMapsPhone}`, businessName: nameRaw, primaryCategoryId: task.categoryId, subcategory: task.subcategory,
                experienceYears: 3, serviceMode: "Local", city: task.city, locality: task.city, state: task.state,
                whatsappNumber: cleanMapsPhone, callNumber: cleanMapsPhone, isApproved: true,
                profilePhotoUrl: portfolio[0] || "", portfolioUrls: portfolio.join(','),
                lastSeen: Date.now(), latitude: lat, longitude: lon, fullAddress: cleanAddr, referredBy: "V172_BATCH"
            });
            summary.discovered.push(`${nameRaw} (${cleanMapsPhone})`);
        }
        return false;
    } catch (e) { return false; }
}

runWorker();
