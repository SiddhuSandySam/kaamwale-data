const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/**
 * ON-DEMAND REFRESHER (V100 - FIRESTORE QUEUE MODE)
 */
const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');

// INITIALIZE FIREBASE
if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    console.error("❌ Firebase Key missing! Please add serviceAccountKey.json");
    process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE));
if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function extractPortfolio(page) {
    try {
        console.log("   📸 Deep Scraping Portfolio (Incremental Extraction Mode)...");
        if (page.isClosed()) return [];

        const photoTrigger = await page.$('button[data-value="Photos"], button[aria-label^="Photos"], .m6x62c');
        let galleryOpened = false;
        if (photoTrigger) {
            console.log("      ✅ Opening Photo Gallery Grid...");
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
        console.log(`   🖼️ Found ${portfolio.length} total high-res images.`);
        return portfolio;
    } catch (e) { console.log(`   ⚠️ Portfolio Error: ${e.message}`); return []; }
}

async function runOnDemand() {
    console.log("🚀 FETCHING BROKEN IMAGES FROM FIRESTORE QUEUE...");

    // 1. Fetch from 'broken_images' collection (Limit to 50 for safety)
    const snapshot = await db.collection('broken_images').limit(50).get();
    if (snapshot.empty) {
        console.log("✅ QUEUE EMPTY: No broken images to fix.");
        return;
    }

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    for (const doc of snapshot.docs) {
        const task = doc.data(); // Contains { id, name, addr, state }
        const dbPhone = String(task.id).replace('shadow_', '');

        console.log(`\n🔍 FIXING: ${task.name} (${dbPhone}) in ${task.state}`);

        try {
            await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`);
            await page.waitForTimeout(4000);

            // PHONE VERIFICATION
            const mapsPhoneRaw = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
            const cleanMapsPhone = mapsPhoneRaw.replace(/[^0-9]/g, '').slice(-10);

            if (cleanMapsPhone === dbPhone) {
                let portfolio = await extractPortfolio(page);
                if (portfolio.length > 0) {
                    const payload = {
                        type: "BATCH_IMAGE_UPDATE",
                        state: task.state,
                        updates: [{
                            id: String(task.id),
                            profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                            portfolioUrls: portfolio.join(',')
                        }]
                    };

                    const resp = await axios.post(HUB_URL, payload);
                    if (String(resp.data).includes("Success")) {
                        console.log(`✅ [UPDATED] Sheet Sync Done. Removing from Queue...`);
                        await db.collection('broken_images').doc(doc.id).delete();
                    }
                }
            } else {
                console.log(`⚠️ [SKIP] Phone mismatch. Maps: ${cleanMapsPhone}`);
                // Optional: Delete from queue if it's a permanent mismatch
                // await db.collection('broken_images').doc(doc.id).delete();
            }
        } catch (err) { console.log(`❌ Error: ${err.message}`); }
    }

    await browser.close();
    console.log("\n🏁 BATCH COMPLETED.");
}

runOnDemand().catch(console.error);
