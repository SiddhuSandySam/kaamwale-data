const { chromium } = require('playwright');
const axios = require('axios');

/**
 * ULTRA-ROBUST ON-DEMAND REFRESHER (V107 - STRICT MATCHING)
 * High Precision Logging + Multi-Selector Phone Matching
 */
const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}] ${msg}`);
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
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/') && !el.src.includes('shared-v1')) {
                    const base = el.src.split('=')[0].split('/s')[0];
                    links.add(base);
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

async function runRefresher() {
    writeLog("🚀 STARTING ON-DEMAND REFRESH (STRICT MATCH MODE)...");
    try {
        const tasks = (await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" })).data;
        if (!Array.isArray(tasks) || tasks.length === 0) return writeLog("✅ Queue Empty.");

        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        for (const task of tasks) {
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
                writeLog(`📱 Verification: Maps[${mapsPhone}] | DB[${dbPhone}]`);

                const isMatch = (mapsPhone !== "NOT_FOUND") && (mapsPhone.includes(dbPhone) || dbPhone.includes(mapsPhone));

                if (isMatch) {
                    writeLog("✅ Phone Matched! Extracting photos...");
                    let portfolio = await extractPortfolio(page);
                    if (portfolio.length > 0) {
                        writeLog(`📸 Found ${portfolio.length} images.`);
                        const newUrl = portfolio[0].split('=')[0] + '=w500-h500-k-no';

                        const res = (await axios.post(HUB_URL, {
                            type: "BATCH_IMAGE_UPDATE",
                            state: task.state,
                            updates: [{ id: task.id, profilePhotoUrl: newUrl, portfolioUrls: portfolio.join(',') }]
                        })).data;

                        if (String(res).includes("Success")) {
                            writeLog(`🎉 SUCCESS: Sheet Updated.`);
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                        }
                    } else {
                        writeLog("⚠️ NO PHOTOS found.");
                        await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                    }
                } else {
                    writeLog(`❌ SKIP: Phone mismatch or NOT_FOUND. Cleaning task.`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                }
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }
        await browser.close();
    } catch (e) { writeLog(`❌ Fatal: ${e.message}`); }
}

runRefresher();
