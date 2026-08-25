const { chromium } = require('playwright');
const axios = require('axios');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
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

        // 🚀 Target "Photos" button specifically
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');

        if (photoBtn) {
            writeLog("🖱️ Entering Full Photo Gallery...");
            await photoBtn.click({ force: true });
            await page.waitForTimeout(5000);

            // 🚀 SMART SCROLLER: Finds the correct scrollable div for photos
            await page.evaluate(async () => {
                const findScrollable = () => {
                    const elements = document.querySelectorAll('div[role="main"], div[role="grid"], div[aria-label*="Photos"], .m67q60');
                    for (let el of elements) {
                        if (el.scrollHeight > el.clientHeight) return el;
                    }
                    return document.querySelector('div[tabindex="0"]'); // Fallback
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

        // 🚀 ULTRA EXTRACTION: Get img src AND background-images
        return await page.evaluate(() => {
            const links = new Set();

            // 1. Standard images
            document.querySelectorAll('img').forEach(el => {
                const src = el.src || "";
                if (src.includes('googleusercontent.com') && !src.includes('/a/') && !src.includes('shared-v1')) {
                    links.add(src.split('=')[0].split('/s')[0]);
                }
            });

            // 2. Background images (Google uses these a lot now)
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
    writeLog("🚀 STARTING GALLERY BEAST MODE...");
    try {
        const tasks = (await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" })).data;
        if (!Array.isArray(tasks) || tasks.length === 0) return writeLog("✅ Queue Empty.");

        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();

        for (const task of tasks) {
            writeLog(`\n🎯 TARGET: ${task.name}`);
            const dbPhone = String(task.id).replace('shadow_', '');

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);

                const results = await page.$$('a.hfpxzc');
                if (results.length > 0) {
                    writeLog(`🖱️ List detected. Selecting top result...`);
                    await results[0].click();
                    await page.waitForTimeout(5000);
                }

                const mapsPhone = await extractPhone(page);
                writeLog(`📱 Verification: Maps[${mapsPhone}] | DB[${dbPhone}]`);

                const isMatch = (mapsPhone !== "NOT_FOUND") && (mapsPhone.includes(dbPhone) || dbPhone.includes(mapsPhone));

                if (isMatch || mapsPhone === "NOT_FOUND") {
                    if (mapsPhone === "NOT_FOUND") writeLog("⚠️ Number not found, trying photos anyway...");
                    else writeLog("✅ Phone Matched!");

                    let portfolio = await extractPortfolio(page);
                    if (portfolio.length > 0) {
                        writeLog(`📸 BOOM! Found ${portfolio.length} images.`);
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
                    } else { writeLog("⚠️ NO PHOTOS found even in beast mode."); }
                } else {
                    writeLog(`❌ MISMATCH: Number different.`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: task.id });
                }
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }
        await browser.close();
    } catch (e) { writeLog(`❌ Fatal: ${e.message}`); }
}

runRefresher();
