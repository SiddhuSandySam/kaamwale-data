const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * ULTRA-ROBUST MULTI-WORKER REFRESHER (V105 - ENHANCED GALLERY)
 * Deep Scroll + 30 Images Limit + Multi-Worker Queue
 */
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

async function extractPortfolio(page) {
    try {
        await page.waitForTimeout(4000);
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');

        if (photoBtn) {
            writeLog("🖱️ Opening full gallery...");
            await photoBtn.click({ force: true });
            await page.waitForTimeout(6000);

            // 🚀 DEEP SCROLLING: Scroll 6 times to get at least 30-40 images
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) {
                    for(let i=0; i<6; i++) {
                        gallery.scrollBy(0, 2000);
                        await new Promise(r => setTimeout(r, 600));
                    }
                }
            });
            await page.waitForTimeout(3000);
        }

        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    const base = el.src.split('=')[0].split('/s')[0];
                    links.add(base);
                }
            });
            // 🚀 INCREASED LIMIT: Taking up to 30 unique images
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function sendRequestWithRetry(payload, label, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const resp = await axios.post(HUB_URL, payload, { timeout: 120000 });
            return resp.data;
        } catch (e) {
            writeLog(`⚠️ [ERROR] ${label} failed: ${e.message}. Retrying...`);
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

async function runWorker() {
    writeLog(`🚀 Worker Starting... Partition: ${WORKER_ID}/${TOTAL_WORKERS}`);
    try {
        const allTasks = (await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" }, { timeout: 60000 })).data;
        if (!Array.isArray(allTasks) || allTasks.length === 0) {
            writeLog("✅ Queue empty. Exit.");
            return;
        }

        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);
        if (myTasks.length === 0) return writeLog("💤 No tasks for me.");

        const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();

        for (const task of myTasks) {
            writeLog(`\n🎯 TARGET: ${task.name}`);
            const dbPhone = String(task.id).replace('shadow_', '');

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);

                const listResults = await page.$$('a.hfpxzc');
                if (listResults.length > 0) {
                    writeLog(`🖱️ Clicking list result...`);
                    await listResults[0].click();
                    await page.waitForTimeout(5000);
                }

                const mapsPhone = await extractPhone(page);
                const isMatch = (mapsPhone !== "NOT_FOUND") && (mapsPhone.includes(dbPhone) || dbPhone.includes(mapsPhone));

                if (isMatch || mapsPhone === "NOT_FOUND") {
                    writeLog(`✅ Phone Match OK. Extracting heavy gallery...`);
                    let portfolio = await extractPortfolio(page);

                    if (portfolio.length > 0) {
                        const newUrl = portfolio[0].split('=')[0] + '=w500-h500-k-no';
                        const res = (await axios.post(HUB_URL, {
                            type: "BATCH_IMAGE_UPDATE",
                            state: task.state,
                            updates: [{ id: task.id, profilePhotoUrl: newUrl, portfolioUrls: portfolio.join(',') }]
                        })).data;

                        if (String(res).includes("Success")) {
                            writeLog(`🎉 Updated with ${portfolio.length} images!`);
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                        }
                    } else { writeLog("⚠️ No Photos."); }
                } else {
                    writeLog(`❌ SKIP: Mismatch (${mapsPhone} vs ${dbPhone}).`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                }
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }
        await browser.close();
    } catch (e) { writeLog(`❌ Fatal: ${e.message}`); }
}

runWorker();
