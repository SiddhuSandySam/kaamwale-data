const { chromium } = require('playwright');
const axios = require('axios');

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[W${WORKER_ID}] [${timestamp}] ${msg}`);
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

async function extractKeywords(page) {
    try {
        return await page.evaluate(() => {
            const category = document.querySelector('button[jsaction="pane.rating.category"]')?.innerText || "";
            const tags = Array.from(document.querySelectorAll('.YR19ub')).map(el => el.innerText).join(",");
            return (category + "," + tags).split(',').map(s => s.trim()).filter(s => s.length > 2).join(",");
        });
    } catch (e) { return ""; }
}

async function checkClosed(page) {
    try {
        return await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes("Permanently closed") || text.includes("कायमचे बंद");
        });
    } catch (e) { return false; }
}

async function extractPortfolio(page) {
    try {
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
            await photoBtn.click({ force: true });
            await page.waitForTimeout(6000);
            await page.evaluate(async () => {
                const findScrollable = () => {
                    const elements = document.querySelectorAll('div[role="main"], div[role="grid"], div[aria-label*="Photos"], .m67q60');
                    for (let el of elements) { if (el.scrollHeight > el.clientHeight) return el; }
                    return document.querySelector('div[tabindex="0"]');
                };
                const scrollArea = findScrollable();
                if (scrollArea) {
                    for(let i=0; i<8; i++) {
                        scrollArea.scrollBy(0, 2000);
                        await new Promise(r => setTimeout(r, 700));
                    }
                }
            });
            await page.waitForTimeout(3000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src?.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    // Deduplicate by stripping size parameters
                    links.add(el.src.split('=')[0].split('/s')[0]);
                }
            });
            document.querySelectorAll('div[style*="background-image"]').forEach(el => {
                const bg = el.style.backgroundImage;
                const match = bg.match(/url\(["']?([^"']+)["']?\)/);
                if (match && match[1].includes('googleusercontent.com') && !match[1].includes('/a/')) {
                    links.add(match[1].split('=')[0].split('/s')[0]);
                }
            });
            // Append s1000 for high quality
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`Worker ${WORKER_ID} Started.`);
    try {
        const allTasks = (await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" })).data;
        if (!Array.isArray(allTasks) || allTasks.length === 0) return writeLog("Queue Empty.");

        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);
        const browser = await chromium.launch({ headless: true }); // Server run
        const page = await browser.newPage();

        let pendingUpdates = [];
        let completedIds = [];

        for (const task of myTasks) {
            const dbPhone = String(task.id).replace('shadow_', '');
            writeLog(`\n🔍 START SCAN: ${task.name} | Target Phone: ${dbPhone} | Location: ${task.addr}`);

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);

                const results = await page.$$('a.hfpxzc');
                if (results.length > 0) {
                    await results[0].click();
                    await page.waitForTimeout(5000);
                }

                // 1. Check if the business is closed
                if (await checkClosed(page)) {
                    writeLog(`🗑️ SKIP [CLOSED]: ${task.name} is permanently closed. Sending delete request.`);
                    await axios.post(HUB_URL, { type: "DELETE_ENTRIES", ids: [task.id], state: task.state });
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: [task.id] });
                    continue;
                }

                // 2. Phone Matching Logic
                const mapsPhone = await extractPhone(page);
                const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
                const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

                if (isMatch) {
                    writeLog(`✅ PHONE MATCH: Found ${cleanMapsPhone} on Maps. (Expected: ${dbPhone})`);

                    const keywords = await extractKeywords(page);
                    let portfolio = await extractPortfolio(page);

                    if (portfolio.length > 0) {
                        writeLog(`📸 PORTFOLIO FOUND: ${portfolio.length} images extracted.`);
                        // Log first 3 URLs for verification
                        portfolio.slice(0, 3).forEach((url, idx) => writeLog(`   [${idx+1}] ${url}`));

                        pendingUpdates.push({
                            id: task.id,
                            state: task.state,
                            profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                            portfolioUrls: portfolio.join(','),
                            searchKeywords: keywords
                        });
                        completedIds.push(task.id);

                        if (pendingUpdates.length >= 5) { // Faster sync
                            await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: pendingUpdates });
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: completedIds });
                            writeLog(`🚀 BATCH SUCCESS: ${pendingUpdates.length} providers updated in Hub.`);
                            pendingUpdates = []; completedIds = [];
                        }
                    } else {
                        writeLog(`⚠️ SKIP [NO IMAGES]: Found profile and phone matched, but no portfolio images available.`);
                        await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: [task.id] });
                    }
                } else {
                    writeLog(`❌ SKIP [MISMATCH]: Phone number on Maps (${cleanMapsPhone}) does not match DB (${dbPhone}).`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: [task.id] });
                }
            } catch (err) { writeLog(`❌ ERROR: Failed to process ${task.name}: ${err.message}`); }
        }
        if (pendingUpdates.length > 0) {
            await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: pendingUpdates });
            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: completedIds });
        }
        await browser.close();
    } catch (e) { writeLog(`Fatal: ${e.message}`); }
}

runWorker();
