/**
 * RAPIDHELP IMAGE REFRESHER 📸 (PRECISION ENGINE V4)
 * 🚀 POWERED BY: Full Address Search & Multi-Worker Extraction.
 * 🛡️ HANDLES: Address Mismatches, List Clicks, and Deep Scrapping.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

// 🚀 WORKER CONFIG
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;
const TARGET_STATE = args[2] || null;

const BATCH_SIZE = 10;
const PUSH_INTERVAL = 50;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // 🚀 1 Month TTL

let updateBatch = [];
let totalUpdatedCount = 0;
let updatedRecordsSummary = [];

// 🚀 REGISTRY HELPERS
const REGISTRY_FILE = path.join(__dirname, `refresher_registry_W${WORKER_ID}.json`);
let refreshRegistry = {};
if (fs.existsSync(REGISTRY_FILE)) {
    try { refreshRegistry = JSON.parse(fs.readFileSync(REGISTRY_FILE)); } catch (e) { refreshRegistry = {}; }
}

function saveRegistry() {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(refreshRegistry, null, 2));
}

// 🚀 UTILITIES
async function isUrlBroken(url) {
    if (!url || url.startsWith('data:')) return true;
    try {
        const response = await axios.get(url, { timeout: 5000, responseType: 'stream' });
        response.data.destroy();
        if (response.status >= 400) {
            console.log(`  🔍 [CHECK] URL Status: ${response.status} (Broken)`);
            return true;
        }
        return false;
    } catch (e) {
        console.log(`  🔍 [CHECK] URL Error: ${e.response?.status || 'Timeout/Network'} (Refresh Needed)`);
        return true;
    }
}

async function verifyPhoneNumber(page, targetMobile) {
    try {
        const phoneBtn = await page.waitForSelector('button[data-item-id^="phone"]', { timeout: 10000 });
        if (!phoneBtn) return false;

        const phoneText = await phoneBtn.innerText();
        const cleanPhone = phoneText.replace(/[^0-9]/g, '').slice(-10);
        const match = cleanPhone === targetMobile.slice(-10);

        if (!match) console.log(`      ❌ [VERIFY] Map Phone: ${cleanPhone} != Target: ${targetMobile}`);
        else console.log(`      ✅ [VERIFY] Phone Match!`);

        return match;
    } catch (e) {
        return false;
    }
}

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

        // 🛡️ ATOMIC SYNC: Fetch, Rebase and Push
        execSync('git add .');
        execSync(`git commit -m "Worker: Progressive image refresh [${count} updates] [skip ci]" || echo "No changes to commit"`);

        console.log("  🔄 Pulling latest changes...");
        execSync('git pull --rebase origin main');

        console.log("  🚀 Pushing to origin...");
        execSync('git push origin main');

        console.log(`✅ GIT SYNC SUCCESSFUL.`);
    } catch (err) {
        console.log(`⚠️ GIT SYNC ERROR: ${err.message}`);
        // If rebase failed, abort it to keep repo clean
        try { execSync('git rebase --abort'); } catch(e) {}
    }
}

async function flushBatch() {
    if (updateBatch.length === 0) return;
    try {
        const payload = { type: "BATCH_IMAGE_UPDATE", updates: updateBatch };
        console.log(`  📤 [HUB] Pushing ${updateBatch.length} updates to Master Engine...`);
        const response = await axios.post(HUB_URL, payload);
        console.log(`  📥 [HUB] Response: ${response.data}`);

        if (response.data.includes("Success")) {
            totalUpdatedCount += updateBatch.length;
            updatedRecordsSummary.push(...updateBatch.map(u => ({ id: u.id, name: u.name })));
            updateBatch = [];
            if (totalUpdatedCount % PUSH_INTERVAL === 0) await gitPush(totalUpdatedCount);
        }
    } catch (err) { console.error(`  ❌ [HUB] ERROR: ${err.message}`); }
}

async function extractPortfolio(page) {
    try {
        await page.evaluate(async () => {
            const h1 = document.querySelector('h1.DUwDvf');
            const panel = h1 ? h1.closest('div[role="main"], div[role="dialog"]') : document.querySelector('div[role="main"]');
            if (panel) { for (let i = 0; i < 3; i++) { panel.scrollBy(0, 800); await new Promise(r => setTimeout(r, 600)); } }
        });
        await page.waitForTimeout(1500);
        return await page.evaluate(() => {
            const links = new Set();
            const h1 = document.querySelector('h1.DUwDvf');
            const panel = h1 ? h1.closest('div[role="main"], div[role="dialog"]') : document.body;
            if (!panel) return [];
            panel.querySelectorAll('img').forEach(img => {
                const src = img.src || '';
                if (src.includes('googleusercontent.com') && !src.includes('base64')) {
                    if (src.includes('/a/') || src.includes('/a-/') || src.includes('shared-v1')) return;
                    let cleanUrl = src;
                    if (src.includes('=') && !src.includes('gps-cs-s')) {
                        cleanUrl = src.split('=')[0].split('/s')[0] + '=w1000-h1000';
                    } else if (src.includes('=s')) {
                        cleanUrl = src.replace(/=s\d+/, '=s1000');
                    }
                    links.add(cleanUrl);
                }
            });
            return Array.from(links).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function refreshImages(stateName) {
    console.log(`\n===============================================`);
    console.log(`🔄 REFRESH SESSION [W${WORKER_ID}/${TOTAL_WORKERS}]: ${stateName}`);
    console.log(`===============================================`);

    const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
    const gridDir = path.join(__dirname, folderName);
    if (!fs.existsSync(gridDir)) return console.error(`❌ Folder not found: ${folderName}`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    const files = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));
    let providerGlobalIndex = 0;

    for (const file of files) {
        const filePath = path.join(gridDir, file);
        let providers = JSON.parse(fs.readFileSync(filePath));
        let fileChanged = false;

        for (let p of providers) {
            if (!p.id.startsWith('shadow_')) continue;

            // 🚀 DYNAMIC SPLIT: Only process assigned providers
            const myTurn = (providerGlobalIndex % TOTAL_WORKERS === WORKER_ID);
            providerGlobalIndex++;
            if (!myTurn) continue;

            const mobile = p.id.split('_')[1] || "N/A";
            let cleanName = p.businessName.split('|')[0].split(',')[0].trim();

            // 🛡️ 1. QUICK REGISTRY SKIP (1 Month TTL)
            const lastChecked = refreshRegistry[mobile] || 0;
            const needsCheck = (Date.now() - lastChecked > THIRTY_DAYS_MS);

            if (!needsCheck) {
                console.log(`  ⏭️ [FAST SKIP] ${cleanName} (${mobile}) - Checked recently.`);
                continue;
            }

            // 🛡️ 2. SMART CHECK: If even ONE is broken, refresh the whole provider
            let broken = await isUrlBroken(p.profilePhotoUrl);
            if (!broken && Array.isArray(p.portfolioUrls) && p.portfolioUrls.length > 0) {
                for (let i = 0; i < Math.min(p.portfolioUrls.length, 3); i++) {
                    if (await isUrlBroken(p.portfolioUrls[i])) {
                        console.log(`  🔍 [CHECK] Portfolio item #${i+1} broken. Refreshing all...`);
                        broken = true;
                        break;
                    }
                }
            }

            if (!broken) {
                console.log(`✅ Provider: ${cleanName} | 📱 ${mobile} | Status: ALL OK`);
                refreshRegistry[mobile] = Date.now(); // Mark as checked today
                saveRegistry();
                continue;
            }

            console.log(`\n🚨 Provider: ${cleanName} | 📱 ${mobile} | Status: REFRESH NEEDED (Token Expired)`);

            // 🛡️ 3. SEARCH ON MAPS
            const query = `${cleanName}, ${p.fullAddress || (p.locality + ", " + p.city)}`;
            try {
                process.stdout.write(`  🔍 Searching Maps... `);
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
                console.log("Done.");

                // 🛡️ Handle Consent
                const consent = await page.$('button[aria-label*="Accept"], button[aria-label*="Agree"], button[aria-label*="स्वीकार"]');
                if (consent) { await consent.click(); await page.waitForTimeout(2000); }

                // 🛡️ 4. VERIFY & SELECT
                const results = await page.$$('a.hfpxzc, div.m67q60 button');
                if (results.length > 0) {
                    console.log(`  🖱️ Found ${results.length} results. Checking each...`);
                    let matched = false;
                    for (let i = 0; i < Math.min(results.length, 5); i++) {
                        console.log(`    👉 Checking Result #${i+1}...`);
                        await results[i].click();
                        await page.waitForTimeout(3000);
                        if (await verifyPhoneNumber(page, mobile)) {
                            matched = true; break;
                        }
                    }
                    if (!matched) {
                        console.log(`  ❌ MISMATCH: No matching provider in search results. Skipping.`);
                        refreshRegistry[mobile] = Date.now(); // Still mark to avoid retrying junk
                        saveRegistry();
                        continue;
                    }
                } else {
                    console.log(`  🔍 Direct result. Verifying...`);
                    if (!(await verifyPhoneNumber(page, mobile))) {
                        console.log(`  ❌ MISMATCH: Provider mobile doesn't match page. Skipping.`);
                        refreshRegistry[mobile] = Date.now();
                        saveRegistry();
                        continue;
                    }
                }

                // 📸 5. SCRAPE NEW IMAGES
                process.stdout.write(`  📸 Extracting Portfolio... `);
                let portfolio = await extractPortfolio(page);
                console.log(`${portfolio.length} images found.`);

                if (portfolio.length > 0) {
                    const freshHeroUrl = portfolio[0].split('=')[0] + '=w500-h500-k-no';
                    const portfolioString = portfolio.join(',');
                    const oldPortfolioString = Array.isArray(p.portfolioUrls) ? p.portfolioUrls.join(',') : p.portfolioUrls;

                    if (freshHeroUrl !== p.profilePhotoUrl || portfolioString !== oldPortfolioString) {
                        console.log(`  ✨ SUCCESS: Found ${portfolio.length} fresh URLs!`);
                        console.log(`     🔗 Profile Photo: ${freshHeroUrl}`);
                        console.log(`     📂 Portfolio List:`);
                        portfolio.forEach((url, idx) => console.log(`        [${idx+1}] ${url}`));

                        updateBatch.push({ id: p.id, name: p.businessName, profilePhotoUrl: freshHeroUrl, portfolioUrls: portfolioString });
                        p.profilePhotoUrl = freshHeroUrl;
                        p.portfolioUrls = portfolio;
                        fileChanged = true;

                        refreshRegistry[mobile] = Date.now(); // Mark as updated
                        saveRegistry();

                        if (updateBatch.length >= BATCH_SIZE) await flushBatch();
                    } else {
                        console.log(`  ➖ Scraped URLs are identical to local. No update needed.`);
                        refreshRegistry[mobile] = Date.now();
                        saveRegistry();
                    }
                } else {
                    console.log(`  ⚠️ WARNING: Google Maps has NO images for this provider.`);
                    refreshRegistry[mobile] = Date.now();
                    saveRegistry();
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
    saveRegistry(); // Final save
    await gitPush("Final");
    console.log(`\n🏁 REFRESH COMPLETE. Total Updated: ${totalUpdatedCount}`);
    if (updatedRecordsSummary.length > 0) console.table(updatedRecordsSummary);
}

main().catch(console.error);
