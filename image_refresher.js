/**
 * RAPIDHELP IMAGE REFRESHER 📸 (MULTI-WORKER ENGINE V2)
 * 🚀 POWERED BY: Multi-Worker Resilient Logic.
 * 🛡️ HANDLES: Signed URLs, Lazy Loading, and Smart Name Extraction.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

// 🚀 CONFIG
const BATCH_SIZE = 10;
const PUSH_INTERVAL = 50;
let updateBatch = [];
let totalUpdatedCount = 0;
let updatedRecordsSummary = [];

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
    try {
        const payload = { type: "BATCH_IMAGE_UPDATE", updates: updateBatch };
        const response = await axios.post(HUB_URL, payload);
        if (response.data.includes("Success")) {
            totalUpdatedCount += updateBatch.length;
            updatedRecordsSummary.push(...updateBatch.map(u => ({ id: u.id, name: u.name })));
            updateBatch = [];
            if (totalUpdatedCount % PUSH_INTERVAL === 0) await gitPush(totalUpdatedCount);
        }
    } catch (err) { console.error(`  ❌ HUB ERROR: ${err.message}`); }
}

async function refreshImages(stateName) {
    console.log(`\n===============================================`);
    console.log(`🔄 REFRESH SESSION: ${stateName}`);
    console.log(`===============================================`);

    const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
    const gridDir = path.join(__dirname, folderName);
    if (!fs.existsSync(gridDir)) return console.error(`❌ Folder not found: ${folderName}`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const files = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(gridDir, file);
        let providers = JSON.parse(fs.readFileSync(filePath));
        let fileChanged = false;

        for (let p of providers) {
            if (!p.id.startsWith('shadow_')) continue;

            const mobile = p.id.split('_')[1] || "N/A";
            let cleanName = p.businessName.split('|')[0].split(',')[0].trim(); // Even more aggressive cleaning
            console.log(`\n🔍 Provider: ${cleanName} | 📱 Mobile: ${mobile}`);

            try {
                const query = `${cleanName}, ${p.locality}, ${p.city}, ${p.state}`;
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });

                // 🛡️ WORKER LOGIC: Handle Consent
                const consent = await page.$('button[aria-label*="Accept"], button[aria-label*="Agree"], button[aria-label*="स्वीकार"]');
                if (consent) { await consent.click(); await page.waitForTimeout(2000); }

                // 🛡️ WORKER LOGIC: Scroll to trigger lazy images
                await page.evaluate(async () => { window.scrollBy(0, 500); });
                await page.waitForTimeout(2000);

                // 📸 WORKER LOGIC: Extract Portfolio Images (Smart extraction)
                const images = await page.evaluate(() => {
                    const links = new Set();
                    document.querySelectorAll('img').forEach(img => {
                        const src = img.src || '';
                        if (src.includes('googleusercontent.com') && !src.includes('base64')) {
                            if (src.includes('/a/') || src.includes('/a-/') || src.includes('shared-v1')) return;

                            let cleanUrl = src;
                            if (src.includes('=') && !src.includes('gps-cs-s')) {
                                cleanUrl = src.split('=')[0].split('/s')[0] + '=w500-h500-k-no';
                            } else if (src.includes('=s')) {
                                cleanUrl = src.replace(/=s\d+/, '=s500');
                            }
                            links.add(cleanUrl);
                        }
                    });
                    return Array.from(links);
                });

                if (images.length > 0) {
                    const freshUrl = images[0];
                    if (freshUrl !== p.profilePhotoUrl) {
                        console.log(`  ✅ NEW URL: ${freshUrl.substring(0, 40)}...`);
                        updateBatch.push({ id: p.id, name: p.businessName, state: p.state, profilePhotoUrl: freshUrl });
                        p.profilePhotoUrl = freshUrl;
                        fileChanged = true;
                        if (updateBatch.length >= BATCH_SIZE) await flushBatch();
                    } else { console.log(`  ⏭️ STATUS: UP TO DATE`); }
                } else {
                    // Fallback to simpler search if no images found
                    console.log(`  ⚠️ STATUS: NO IMAGES FOUND. TRYING DIRECT INFO...`);
                }

                await page.waitForTimeout(1000);
            } catch (err) { console.error(`  ⚠️ ERROR: ${err.message}`); }
        }
        if (fileChanged) fs.writeFileSync(filePath, JSON.stringify(providers, null, 2));
    }
    await flushBatch();
    await browser.close();
}

async function main() {
    if (TARGET_STATE) { await refreshImages(TARGET_STATE); }
    else {
        const folders = fs.readdirSync(__dirname).filter(f => f.endsWith('_grids'));
        for (const folder of folders) {
            const stateName = folder.replace('_grids', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            await refreshImages(stateName);
        }
    }
    await gitPush("Final");
    console.log(`\n🏁 REFRESH COMPLETE. Total Updated: ${totalUpdatedCount}`);
    if (updatedRecordsSummary.length > 0) console.table(updatedRecordsSummary);
}

main().catch(console.error);
