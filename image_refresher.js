/**
 * RAPIDHELP IMAGE REFRESHER 📸
 * 🚀 PURPOSE: Automatically find and update expired Google Maps image URLs.
 * 🛡️ SAFETY: Updates ONLY image-related columns in the database.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const BATCH_SIZE = 5; // 🚀 Start small for safety

async function refreshImages(stateName, limit = 10) {
    console.log(`\n🔄 Starting Image Refresh for: ${stateName} (Limit: ${limit})`);

    const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
    const gridDir = path.join(__dirname, folderName);

    if (!fs.existsSync(gridDir)) {
        console.error("❌ Folder not found.");
        return;
    }

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    let updatedCount = 0;

    const files = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        if (updatedCount >= limit) break;

        const filePath = path.join(gridDir, file);
        let providers = JSON.parse(fs.readFileSync(filePath));

        for (let p of providers) {
            if (updatedCount >= limit) break;

            // Only refresh "shadow" (scraped) providers with potential 403 issues
            if (!p.id.startsWith('shadow_')) continue;

            console.log(`🔍 Checking: ${p.businessName}...`);

            try {
                const query = `${p.businessName}, ${p.locality}, ${p.city}`;
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`);

                // Wait for panel to load
                await page.waitForSelector('h1.DUwDvf', { timeout: 10000 }).catch(() => {});

                // Extract Fresh Hero Image
                const newPhotoUrl = await page.evaluate(() => {
                    const hero = document.querySelector('button.ao6Gdb img') || document.querySelector('img[decoding="async"]');
                    return (hero && hero.src && !hero.src.includes('base64')) ? hero.src : "";
                });

                if (newPhotoUrl && newPhotoUrl !== p.profilePhotoUrl) {
                    console.log(`  ✅ Found New URL for ${p.businessName}`);

                    const updatePayload = {
                        type: "IMAGE_UPDATE",
                        id: p.id,
                        state: p.state,
                        profilePhotoUrl: newPhotoUrl.split('=')[0] + '=w500-h500-k-no',
                        // Optional: can add portfolioUrls here too
                    };

                    const response = await axios.post(HUB_URL, updatePayload);
                    if (response.data.includes("Success")) {
                        console.log(`  ✨ Hub Updated successfully.`);
                        p.profilePhotoUrl = updatePayload.profilePhotoUrl;
                        updatedCount++;
                    }
                } else {
                    console.log(`  ⏭️ No change or not found.`);
                }

                await page.waitForTimeout(2000); // Anti-block delay
            } catch (err) {
                console.error(`  ❌ Error: ${err.message}`);
            }
        }

        // Save back to local JSON
        fs.writeFileSync(filePath, JSON.stringify(providers, null, 2));
    }

    await browser.close();
    console.log(`\n🏁 Refresh Complete. Updated ${updatedCount} providers.`);
}

// 🚀 TEST RUN: Refresh 5 images from Maharashtra
refreshImages("Maharashtra", 5).catch(console.error);
