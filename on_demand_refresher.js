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
