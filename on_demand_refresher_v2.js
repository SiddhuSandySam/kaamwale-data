const { chromium } = require('playwright');
const axios = require('axios');

/**
 * ON-DEMAND REFRESHER V2 (FREE GOOGLE SHEET QUEUE MODE)
 */
const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(4000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) { for (let i = 0; i < 3; i++) { gallery.scrollBy(0, 1500); await new Promise(r => setTimeout(r, 500)); } }
            });
            await page.waitForTimeout(2000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src && el.src.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    links.add(el.src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function runRefresher() {
    console.log("📡 Fetching Pending Tasks from Hub...");
    try {
        const resp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const tasks = resp.data;

        if (!Array.isArray(tasks) || tasks.length === 0) {
            console.log("✅ Queue is empty. No work to do.");
            return;
        }

        console.log(`🚀 Found ${tasks.length} tasks. Starting Browser...`);
        const browser = await chromium.launch({ headless: false });
        const page = await browser.newPage();

        for (const task of tasks) {
            console.log(`\n🔍 Working on: ${task.name} (${task.id})`);
            const dbPhone = String(task.id).replace('shadow_', '');

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });
                await page.waitForTimeout(4000);

                const mapsPhoneRaw = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
                const cleanMapsPhone = mapsPhoneRaw.replace(/[^0-9]/g, '').slice(-10);

                if (cleanMapsPhone === dbPhone) {
                    console.log(`✅ Phone Matched: ${dbPhone}. Extracting photos...`);
                    let portfolio = await extractPortfolio(page);
                    if (portfolio.length > 0) {
                        const syncPayload = {
                            type: "BATCH_IMAGE_UPDATE",
                            state: task.state,
                            updates: [{
                                id: String(task.id),
                                profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                                portfolioUrls: portfolio.join(',')
                            }]
                        };

                        const syncResp = await axios.post(HUB_URL, syncPayload);
                        if (String(syncResp.data).includes("Success")) {
                            console.log(`🎉 Sheet Updated! Marking task as DONE...`);
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", row: task.row });
                        }
                    }
                } else {
                    console.log(`⚠️ Skip: Phone mismatch (${cleanMapsPhone} vs ${dbPhone})`);
                    // Even if mismatch, we mark it done or remove it to clear queue
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", row: task.row });
                }
            } catch (err) { console.log(`❌ Error: ${err.message}`); }
        }

        await browser.close();
        console.log("\n🏁 All tasks processed.");
    } catch (e) { console.error(`Failed to fetch queue: ${e.message}`); }
}

runRefresher();
