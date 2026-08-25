const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * ULTRA-ROBUST MULTI-WORKER REFRESHER (V106 - BEAST MODE PRODUCTION)
 * List Detection + Flexible Match + Beast Gallery + Multi-Worker Queue
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
        await page.waitForTimeout(3000);
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');

        if (photoBtn) {
            writeLog("🖱️ Entering Full Photo Gallery...");
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
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    links.add(el.src.split('=')[0].split('/s')[0]);
                }
            });
            document.querySelectorAll('div[style*="background-image"]').forEach(el => {
                const bg = el.style.backgroundImage;
                const match = bg.match(/url\(["']?([^"']+)["']?\)/);
                if (match && match[1].includes('googleusercontent.com')) {
                    links.add(match[1].split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`🚀 Worker ${WORKER_ID}/${TOTAL_WORKERS} Started.`);
    try {
        const allTasks = (await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" }, { timeout: 60000 })).data;
        if (!Array.isArray(allTasks) || allTasks.length === 0) return writeLog("✅ Queue empty.");

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

                const results = await page.$$('a.hfpxzc');
                if (results.length > 0) {
                    writeLog(`🖱️ List detected. Clicking top result...`);
                    await results[0].click();
                    await page.waitForTimeout(5000);
                }

                const mapsPhone = await extractPhone(page);
                const isMatch = (mapsPhone !== "NOT_FOUND") && (mapsPhone.includes(dbPhone) || dbPhone.includes(mapsPhone));

                if (isMatch || mapsPhone === "NOT_FOUND") {
                    writeLog(`✅ Verification OK. Maps[${mapsPhone}] vs DB[${dbPhone}].`);
                    let portfolio = await extractPortfolio(page);
                    if (portfolio.length > 0) {
                        const newUrl = portfolio[0].split('=')[0] + '=w500-h500-k-no';
                        const res = (await axios.post(HUB_URL, {
                            type: "BATCH_IMAGE_UPDATE",
                            state: task.state,
                            updates: [{ id: task.id, profilePhotoUrl: newUrl, portfolioUrls: portfolio.join(',') }]
                        })).data;

                        if (String(res).includes("Success")) {
                            writeLog(`🎉 SUCCESS: Found ${portfolio.length} images. Updated.`);
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                        }
                    } else { writeLog("⚠️ NO PHOTOS found."); }
                } else {
                    writeLog(`❌ SKIP: Mismatch.`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                }
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }
        await browser.close();
    } catch (e) { writeLog(`❌ Fatal: ${e.message}`); }
}

runWorker();
