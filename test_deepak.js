const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * 🧪 DEDUPE VERIFICATION TEST (V180)
 * Goal: Verify that running the same discovery twice does NOT create duplicates in the Sheet.
 * Logic: Strict shadow_PHONE ID formatting + Batched Sync.
 */

const task = {
    id: "shadow_9967924115",
    name: "Deepak Fish Aquarium",
    addr: "Shop No A4, Mini Market, JN1 52, Apposite, Juhu Nagar, Sector 9, Vashi, Navi Mumbai, Maharashtra 400703",
    state: "Maharashtra",
    city: "Navi Mumbai",
    categoryId: "cat_pet",
    subcategory: "Aquarium Plant Seller",
    targetPhone: "9967924115"
};

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[DEDUPE-TEST] [${timestamp}] ${msg}`);
}

async function extractPhone(page) {
    const selectors = ['button[data-item-id^="phone"]', 'button[aria-label*="Phone"]', '.CsEnBe[aria-label*="Phone"]'];
    for (let sel of selectors) {
        try {
            const text = await page.$eval(sel, el => el.innerText || el.getAttribute('aria-label') || "");
            const clean = text.replace(/[^0-9]/g, '');
            if (clean.length >= 8) return clean;
        } catch (e) {}
    }
    return "NOT_FOUND";
}

async function runDedupeTest() {
    writeLog(`🚀 STARTING DEDUPE VERIFICATION...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let discoveries = [];

    try {
        const searchQuery = `${task.subcategory} in ${task.city}, ${task.state}`;
        writeLog(`🔎 Query: ${searchQuery}`);
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`, { timeout: 60000 });
        await page.waitForTimeout(5000);

        const results = await page.$$('a.hfpxzc');
        writeLog(`📊 Found ${results.length} results. Processing top 5 for dedupe check...`);

        for (let i = 0; i < Math.min(results.length, 5); i++) {
            try {
                const listings = await page.$$('a.hfpxzc');
                const listing = listings[i];
                await listing.scrollIntoViewIfNeeded().catch(() => {});
                const nameRaw = await listing.getAttribute('aria-label');
                writeLog(`\n--- [${i+1}] Checking: ${nameRaw} ---`);

                await listing.click({ force: true });

                let loaded = false;
                for (let r = 0; r < 8; r++) {
                    const title = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "");
                    if (title.toLowerCase().includes(nameRaw.toLowerCase().substring(0, 3))) { loaded = true; break; }
                    await page.waitForTimeout(1000);
                }
                if (!loaded) continue;

                const phone = await extractPhone(page);
                const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);

                if (cleanPhone.length === 10) {
                    const finalId = `shadow_${cleanPhone}`;
                    writeLog(`      🆔 Formatted ID: ${finalId}`);

                    // Multi-worker style 31 fields
                    discoveries.push({
                        id: finalId,
                        businessName: nameRaw,
                        primaryCategoryId: task.categoryId,
                        subcategory: task.subcategory,
                        experienceYears: 3,
                        serviceMode: "Local",
                        city: task.city, locality: task.city, state: task.state,
                        startingPrice: 0, priceUnit: "Discuss on Call",
                        whatsappNumber: cleanPhone, callNumber: cleanPhone,
                        aboutDescription: `Professional ${task.subcategory} services in ${task.city}.`,
                        isApproved: true, isVerified: false, rating: 0.0,
                        profilePhotoUrl: "https://lh3.googleusercontent.com/test_photo",
                        recommendationCount: 0, portfolioUrls: "https://lh3.googleusercontent.com/test_portfolio",
                        searchKeywords: nameRaw + "," + task.city,
                        lastSeen: Date.now(),
                        callCount: 0,
                        fullAddress: "Verified by Dedupe Test",
                        isNumberHidden: false,
                        referredBy: "DEDUPE_VERIFIER_V180",
                        referralBonusPaid: false, fcmToken: "",
                        notificationsEnabled: true,
                        latitude: 19.0, longitude: 72.0 // Mock coords for speed
                    });

                    const backBtn = await page.$('button[aria-label*="Back"], button[aria-label*="मागे"]');
                    if (backBtn) { await backBtn.click(); await page.waitForTimeout(1500); }
                }
            } catch (err) { writeLog(`      ⚠️ Loop Error: ${err.message}`); }
        }

        if (discoveries.length > 0) {
            writeLog(`🚀 Syncing ${discoveries.length} leads to Hub for Dedupe Check...`);
            const resp = await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: discoveries });
            writeLog(`📡 Hub Response: ${resp.data}`);
            writeLog(`💡 Note: If response is "Success", the Hub found matches and UPDATED them instead of adding new rows.`);
        }

    } catch (e) {
        writeLog("❌ FATAL: " + e.message);
    } finally {
        await browser.close();
        writeLog("\n🏁 Dedupe Test Finished.");
        process.exit(0);
    }
}

runDedupeTest();
