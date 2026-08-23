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

// 🚀 ARGS: node image_refresher.js [state] [limit]
const args = process.argv.slice(2);
const TARGET_STATE = args[0] || null;
const REFRESH_LIMIT = parseInt(args[1]) || 50;

async function refreshImages(stateName, limit) {
    console.log(`\n===============================================`);
    console.log(`🔄 REFRESH SESSION: ${stateName} (Limit: ${limit})`);
    console.log(`===============================================`);

    const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
    const gridDir = path.join(__dirname, folderName);

    if (!fs.existsSync(gridDir)) {
        console.error(`❌ Folder not found: ${folderName}`);
        return 0;
    }

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    let updatedCount = 0;

    const files = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        if (updatedCount >= limit) break;

        const filePath = path.join(gridDir, file);
        let providers = JSON.parse(fs.readFileSync(filePath));
        let fileChanged = false;

        for (let p of providers) {
            if (updatedCount >= limit) break;
            if (!p.id.startsWith('shadow_')) continue;

            console.log(`\n🔍 Provider: ${p.businessName} [${p.id}]`);

            try {
                const query = `${p.businessName}, ${p.locality}, ${p.city}`;
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Extract Fresh Hero Image
                const newPhotoUrl = await page.evaluate(() => {
                    const hero = document.querySelector('button.ao6Gdb img') || document.querySelector('img[decoding="async"]');
                    return (hero && hero.src && !hero.src.includes('base64')) ? hero.src : "";
                });

                if (newPhotoUrl && newPhotoUrl !== p.profilePhotoUrl) {
                    const cleanUrl = newPhotoUrl.split('=')[0] + '=w500-h500-k-no';

                    console.log(`  ❌ OLD URL: ${p.profilePhotoUrl.substring(0, 60)}...`);
                    console.log(`  ✅ NEW URL: ${cleanUrl.substring(0, 60)}...`);

                    const updatePayload = {
                        type: "IMAGE_UPDATE",
                        id: p.id,
                        state: p.state,
                        profilePhotoUrl: cleanUrl
                    };

                    const response = await axios.post(HUB_URL, updatePayload);
                    if (response.data.includes("Success")) {
                        console.log(`  ✨ HUB STATUS: UPDATED`);
                        p.profilePhotoUrl = cleanUrl;
                        fileChanged = true;
                        updatedCount++;
                    }
                } else {
                    console.log(`  ⏭️ STATUS: NO CHANGE / NOT FOUND`);
                }
                await page.waitForTimeout(2000);
            } catch (err) {
                console.error(`  ⚠️ ERROR: ${err.message}`);
            }
        }

        if (fileChanged) {
            fs.writeFileSync(filePath, JSON.stringify(providers, null, 2));
        }
    }

    await browser.close();
    return updatedCount;
}

async function main() {
    if (TARGET_STATE) {
        await refreshImages(TARGET_STATE, REFRESH_LIMIT);
    } else {
        const folders = fs.readdirSync(__dirname).filter(f => f.endsWith('_grids'));
        for (const folder of folders) {
            const stateName = folder.replace('_grids', '').replace(/_/g, ' ');
            const formattedState = stateName.replace(/\b\w/g, l => l.toUpperCase());
            await refreshImages(formattedState, REFRESH_LIMIT);
        }
    }
    console.log(`\n🏁 Global Refresh Session Complete.`);
}

main().catch(console.error);
