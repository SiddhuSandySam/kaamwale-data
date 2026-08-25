const { chromium } = require('playwright');
const axios = require('axios');

/**
 * ULTRA-ROBUST ON-DEMAND REFRESHER (V102 - MANUAL TEST MODE)
 * High Precision Logging + Multi-Selector Phone Matching
 */
const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}] ${msg}`);
}

async function extractPhone(page) {
    const selectors = [
        'button[data-item-id^="phone"]',
        'button[aria-label*="Phone"]',
        'button[aria-label*="फोन"]',
        '.CsEnBe[aria-label*="Phone"]'
    ];
    for (let sel of selectors) {
        try {
            const text = await page.$eval(sel, el => el.innerText || el.getAttribute('aria-label') || "");
            if (text) {
                const clean = text.replace(/[^0-9]/g, '').slice(-10);
                if (clean.length === 10) return clean;
            }
        } catch (e) {}
    }
    return "";
}

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(5000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) { for (let i = 0; i < 4; i++) { gallery.scrollBy(0, 1500); await new Promise(r => setTimeout(r, 600)); } }
            });
            await page.waitForTimeout(2000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img, div[style*="background-image"]').forEach(el => {
                let src = el.tagName === 'IMG' ? el.src : (el.style.backgroundImage.match(/url\(["']?([^"']+)["']?\)/) || [])[1];
                if (src && src.includes('googleusercontent.com') && !src.includes('/a/')) {
                    links.add(src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function sendRequestWithRetry(payload, label, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            writeLog(`📡 [SYNC] Sending ${label} (Attempt ${i + 1})...`);
            const resp = await axios.post(HUB_URL, payload, { timeout: 120000 });
            writeLog(`📩 [RESPONSE] ${JSON.stringify(resp.data)}`);
            return resp.data;
        } catch (e) {
            writeLog(`⚠️ [ERROR] ${e.message}. Retrying in 10s...`);
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

async function runRefresher() {
    writeLog("🚀 MANUAL REFRESH START...");
    try {
        const tasks = await sendRequestWithRetry({ type: "GET_REFRESH_QUEUE" }, "Fetch Tasks");

        if (!Array.isArray(tasks) || tasks.length === 0) {
            writeLog("✅ Queue is empty.");
            return;
        }

        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();

        for (const task of tasks) {
            writeLog(`\n--- TARGET: ${task.name} ---`);
            const dbPhone = String(task.id).replace('shadow_', '');

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`);
                await page.waitForTimeout(5000);

                const mapsPhone = await extractPhone(page);
                writeLog(`📱 Maps: [${mapsPhone}] | DB: [${dbPhone}]`);

                if (mapsPhone === dbPhone) {
                    writeLog("✅ Match! Fetching photos...");
                    let portfolio = await extractPortfolio(page);
                    if (portfolio.length > 0) {
                        const syncPayload = {
                            type: "BATCH_IMAGE_UPDATE",
                            state: task.state,
                            updates: [{ id: String(task.id), profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no', portfolioUrls: portfolio.join(',') }]
                        };
                        const res = await sendRequestWithRetry(syncPayload, `Sync ${task.name}`);
                        if (String(res).includes("Success")) {
                            writeLog(`🎉 Done!`);
                            await sendRequestWithRetry({ type: "MARK_REFRESH_DONE", row: task.row }, "Mark DONE");
                        }
                    }
                } else {
                    writeLog(`❌ Skip: Mismatch.`);
                    await sendRequestWithRetry({ type: "MARK_REFRESH_DONE", row: task.row }, "Cleanup");
                }
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }
        await browser.close();
    } catch (e) { writeLog(`❌ Fatal: ${e.message}`); }
}

runRefresher();
