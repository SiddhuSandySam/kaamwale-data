/**
 * RAPIDHELP IMAGE REFRESHER 📸
 * 🚀 PURPOSE: Automatically find and update expired Google Maps image URLs.
 * 🛡️ PROGRESSIVE: Updates Hub in batches and Pushes to Git periodically.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

// 🚀 CONFIG
const BATCH_SIZE = 10; // Send 10 updates at once to Sheet
const PUSH_INTERVAL = 50; // Git Push every 50 updates
let updateBatch = [];
let totalUpdatedCount = 0;

const args = process.argv.slice(2);
const TARGET_STATE = args[0] || null;

async function gitPush(count) {
    console.log(`\n📦 SYNCING TO GIT: ${count} updates...`);
    try {
        execSync('git config --global user.name "RapidHelp-Bot"');
        execSync('git config --global user.email "bot@rapidhelp.in"');
        execSync('git add .');
        execSync(`git commit -m "Worker: Progressive image refresh [${count} updates] [skip ci]"`);
        execSync('git push origin main');
        console.log(`✅ GIT SYNC SUCCESSFUL.`);
    } catch (err) {
        console.log(`⚠️ GIT SYNC SKIPPED (No changes or error: ${err.message})`);
    }
}

async function flushBatch() {
    if (updateBatch.length === 0) return;

    console.log(`  ✨ HUB UPDATE: Sending batch of ${updateBatch.length} to Sheet...`);
    try {
        const payload = {
            type: "BATCH_IMAGE_UPDATE", // Ensure your Apps Script handles an array
            updates: updateBatch
        };
        const response = await axios.post(HUB_URL, payload);
        if (response.data.includes("Success")) {
            console.log(`  ✅ HUB STATUS: BATCH SYNCED`);
            totalUpdatedCount += updateBatch.length;
            updateBatch = [];

            // Periodic Git Push
            if (totalUpdatedCount % PUSH_INTERVAL === 0) {
                await gitPush(totalUpdatedCount);
            }
        }
    } catch (err) {
        console.error(`  ❌ HUB ERROR: ${err.message}`);
    }
}

async function refreshImages(stateName) {
    console.log(`\n===============================================`);
    console.log(`🔄 REFRESH SESSION: ${stateName}`);
    console.log(`===============================================`);

    const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
    const gridDir = path.join(__dirname, folderName);

    if (!fs.existsSync(gridDir)) {
        console.error(`❌ Folder not found: ${folderName}`);
        return;
    }

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    const files = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(gridDir, file);
        let providers = JSON.parse(fs.readFileSync(filePath));
        let fileChanged = false;

        for (let p of providers) {
            if (!p.id.startsWith('shadow_')) continue;

            console.log(`\n🔍 Provider: ${p.businessName} [${p.id}]`);

            try {
                const query = `${p.businessName}, ${p.locality}, ${p.city}`;
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

                const newPhotoUrl = await page.evaluate(() => {
                    const img = document.querySelector('button.ao6Gdb img') ||
                                document.querySelector('img[src*="googleusercontent.com/p/"]') ||
                                document.querySelector('div.XvH99c img');
                    return (img && img.src && !img.src.includes('base64')) ? img.src : "";
                });

                if (newPhotoUrl) {
                    const cleanUrl = newPhotoUrl.split('=')[0] + '=w500-h500-k-no';
                    if (cleanUrl !== p.profilePhotoUrl) {
                        console.log(`  ✅ NEW URL FOUND: ${cleanUrl.substring(0, 40)}...`);

                        updateBatch.push({
                            id: p.id,
                            state: p.state,
                            profilePhotoUrl: cleanUrl
                        });

                        p.profilePhotoUrl = cleanUrl;
                        fileChanged = true;

                        if (updateBatch.length >= BATCH_SIZE) {
                            await flushBatch();
                        }
                    } else {
                        console.log(`  ⏭️ STATUS: UP TO DATE`);
                    }
                } else {
                    console.log(`  ⚠️ STATUS: IMAGE NOT FOUND`);
                }
                await page.waitForTimeout(1000);
            } catch (err) {
                console.error(`  ⚠️ ERROR: ${err.message}`);
            }
        }

        if (fileChanged) {
            fs.writeFileSync(filePath, JSON.stringify(providers, null, 2));
        }
    }

    await flushBatch(); // Final flush for remaining updates
    await browser.close();
}

async function main() {
    if (TARGET_STATE) {
        await refreshImages(TARGET_STATE);
    } else {
        const folders = fs.readdirSync(__dirname).filter(f => f.endsWith('_grids'));
        for (const folder of folders) {
            const stateName = folder.replace('_grids', '').replace(/_/g, ' ');
            const formattedState = stateName.replace(/\b\w/g, l => l.toUpperCase());
            await refreshImages(formattedState);
        }
    }
    // Final Git Push
    await gitPush("Final");
    console.log(`\n🏁 Global Refresh Session Complete. Total Updated: ${totalUpdatedCount}`);
}

main().catch(console.error);
