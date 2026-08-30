const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, '../config.json');

let config = { categories: [] };
if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch (e) { console.error("Config load fail"); }
}

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[DISCOVERY-TEST] [${timestamp}] ${msg}`);
}

// 🎯 Mapping Logic: Google Category -> Our Internal Cat/Subcat
function mapCategory(googleCat) {
    if (!googleCat) return { catId: "cat_home", sub: "General" }; // Fallback

    const normalized = googleCat.toLowerCase().trim();
    for (const cat of config.categories) {
        for (const sub of cat.sub) {
            if (normalized.includes(sub.toLowerCase()) || sub.toLowerCase().includes(normalized)) {
                return { catId: cat.id, sub: sub };
            }
        }
    }
    return { catId: "cat_home", sub: "General" };
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

async function runDiscoveryTest() {
    writeLog("🚀 DISCOVERY TEST START: Finding new leads in Ulwe");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    try {
        // Search for something that will give many results
        await page.goto(`https://www.google.com/maps/search/pandit+for+pooja+in+ulwe`, { timeout: 60000 });
        await page.waitForTimeout(8000);

        const results = await page.$$('a.hfpxzc');
        writeLog(`📊 Found ${results.length} total results.`);

        let discoveryDone = 0;

        for (let i = 0; i < Math.min(results.length, 5); i++) {
            const listings = await page.$$('a.hfpxzc');
            const listing = listings[i];
            const nameRaw = await listing.getAttribute('aria-label').catch(() => "Unknown");

            writeLog(`\n🔍 Checking Listing ${i+1}: ${nameRaw}`);
            await listing.scrollIntoViewIfNeeded().catch(() => {});
            await listing.click({ force: true }).catch(() => {});
            await page.waitForTimeout(5000);

            const mapsPhone = await extractPhone(page);
            const cleanPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";

            if (cleanPhone.length === 10) {
                // 1. Get Google Category
                const googleCat = await page.$eval('button[jsaction="pane.rating.category"]', el => el.innerText).catch(() => "");
                const mapped = mapCategory(googleCat);

                writeLog(`✅ MAPPED: [${googleCat}] -> [Cat: ${mapped.catId}, Sub: ${mapped.sub}]`);

                // 2. Get Portfolio Image (Just the main one for test)
                const photo = await page.$eval('img', img => img.src).catch(() => "");

                const lead = {
                    id: `shadow_${cleanPhone}`,
                    businessName: nameRaw,
                    primaryCategoryId: mapped.catId,
                    subcategory: mapped.sub,
                    whatsappNumber: cleanPhone,
                    callNumber: cleanPhone,
                    state: "Maharashtra",
                    city: "Navi Mumbai",
                    locality: "Ulwe",
                    latitude: 19.0, // Temporary for test
                    longitude: 73.0,
                    profilePhotoUrl: photo.split('=')[0] + '=w500-h500-k-no',
                    portfolioUrls: photo,
                    isApproved: true,
                    isVerified: false,
                    referredBy: "TEST_DISCOVERY_BOT",
                    timestamp: Date.now()
                };

                writeLog(`📡 SENDING NEW LEAD TO HUB: ${nameRaw} (${cleanPhone})`);
                const resp = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: [lead] });
                writeLog(`📊 HUB RESULT: ${JSON.stringify(resp.data)}`);

                discoveryDone++;
                if (discoveryDone >= 1) break; // One discovery is enough to confirm test
            } else {
                writeLog("❌ SKIP: No valid phone found.");
            }
        }

    } catch (err) {
        writeLog("❌ ERROR: " + err.message);
    } finally {
        await browser.close();
        writeLog("\n🏁 TEST COMPLETE.");
    }
}

runDiscoveryTest();
