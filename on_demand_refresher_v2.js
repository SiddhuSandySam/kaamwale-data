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
        writeLog("   📸 Deep Scraping Portfolio (Incremental Extraction Mode)...");
        if (page.isClosed()) return [];

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
            const scrolled = await page.evaluate(() => {
                const scrollable = document.querySelector('.m6x62c-v77d8b-view-container, .DxyBCb, div[role="main"], div[tabindex="0"]');
                if (scrollable) { scrollable.scrollBy(0, 1200); return true; }
                return false;
            });
            if (!scrolled) await page.mouse.wheel(0, 1200);
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
