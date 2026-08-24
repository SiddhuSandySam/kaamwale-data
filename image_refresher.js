/**
 * RAPIDHELP IMAGE REFRESHER 📸 (PRECISION ENGINE V5.2)
 * 🚀 POWERED BY: Deep Gallery Extraction & Dynamic Multi-Worker Split.
 * 🛡️ HANDLES: Hidden Photo Galleries, Permanent ID Matching & 30-Day Registry.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

// 🚀 STATE ROUTING TABLE
let stateUrls = {};

async function fetchRoutingTable() {
    try {
        console.log("🌐 Fetching Routing Table from Main Hub...");
        const response = await axios.get(`${HUB_URL}?type=app_data&nocache=true`, { timeout: 30000 });
        if (response.data && response.data.stateUrls) {
            stateUrls = response.data.stateUrls;
            console.log(`✅ Routing Table Loaded. Active States: ${Object.keys(stateUrls).length}`);
        }
    } catch (e) {
        console.error(`❌ FAILED to load Routing Table: ${e.message}`);
    }
}

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
        if (response.status >= 400) return true;
        return false;
    } catch (e) {
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

async function gitPush(count) {
    console.log(`\n📦 SYNCING TO GIT: ${count} updates...`);
    try {
        execSync('git config --global user.name "RapidHelp-Bot"');
        execSync('git config --global user.email "bot@rapidhelp.in"');

        execSync('git add .');
        execSync(`git commit -m "Worker: Progressive image refresh [${count} updates] [skip ci]" || echo "No changes"`);

        console.log("  🔄 Syncing with remote...");
        execSync('git pull --rebase origin main');
        execSync('git push origin main');

        console.log(`✅ GIT SYNC SUCCESSFUL.`);
    } catch (err) {
        console.log(`⚠️ GIT SYNC ERROR: ${err.message}`);
        try { execSync('git rebase --abort'); } catch(e) {}
    }
}

async function flushBatch() {
    if (updateBatch.length === 0) return;
    try {
        // Group updates by state
        const grouped = {};
        updateBatch.forEach(u => {
            const s = u.state || "Unknown";
            if (!grouped[s]) grouped[s] = [];
            grouped[s].push(u);
        });

        for (const stateName of Object.keys(grouped)) {
            const updates = grouped[stateName];
            const targetHub = stateUrls[stateName] || HUB_URL; // Fallback to main hub

            console.log(`  📤 [HUB] Pushing ${updates.length} updates to [${stateName}] Engine...`);
            const response = await axios.post(targetHub, { type: "BATCH_IMAGE_UPDATE", updates: updates });
            const resMsg = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            console.log(`  📥 [HUB] Response from [${stateName}]: ${resMsg}`);

            if (resMsg.includes("Success")) {
                totalUpdatedCount += updates.length;
                updatedRecordsSummary.push(...updates.map(u => ({ id: u.id, name: u.name, state: stateName })));
            }
        }
        updateBatch = [];
        if (totalUpdatedCount % PUSH_INTERVAL === 0) await gitPush(totalUpdatedCount);
    } catch (err) { console.error(`  ❌ [HUB] ERROR: ${err.message}`); }
}

async function extractPortfolio(page) {
    try {
        await page.evaluate(async () => {
            const h1 = document.querySelector('h1.DUwDvf');
            const panel = h1 ? h1.closest('div[role="main"], div[role="dialog"]') : document.querySelector('div[role="main"]');
            if (panel) {
                for (let i = 0; i < 4; i++) {
                    panel.scrollBy(0, 1000);
                    await new Promise(r => setTimeout(r, 800));
                }
            }
        });
        await page.waitForTimeout(1500);

        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoGalleryBtn) {
            console.log("  📸 Gallery found. Opening...");
            await photoGalleryBtn.click();
            await page.waitForTimeout(4000);

            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) {
                    for (let i = 0; i < 8; i++) {
                        gallery.scrollBy(0, 1500);
                        await new Promise(r => setTimeout(r, 700));
                    }
                }
            });
            await page.waitForTimeout(2000);
        }

        return await page.evaluate(() => {
            const links = new Set();
            const allElements = Array.from(document.querySelectorAll('img, div[style*="background-image"]'));

            allElements.forEach(el => {
                let src = '';
                if (el.tagName === 'IMG') {
                    src = el.src || '';
                } else {
                    const bg = el.style.backgroundImage;
                    if (bg && bg.includes('url')) {
                        src = bg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
                    }
                }

                if (!src || src.startsWith('data:')) return;

                const photoId = el.getAttribute('data-photo-id');

                if (photoId) {
                    links.add(`https://lh3.googleusercontent.com/p/${photoId}=s1000`);
                } else if (src.includes('googleusercontent.com')) {
                    if (src.includes('/a/') || src.includes('/a-/') || src.includes('shared-v1')) return;

                    const pMatch = src.match(/\/p\/([A-Za-z0-9_-]+)/);
                    if (pMatch && pMatch[1]) {
                        links.add(`https://lh3.googleusercontent.com/p/${pMatch[1]}=s1000`);
                    } else {
                        let cleanUrl = src;
                        if (src.includes('=') && !src.includes('gps-cs-s')) {
                            cleanUrl = src.split('=')[0].split('/s')[0] + '=w1000-h1000';
                        } else if (src.includes('=s')) {
                            cleanUrl = src.replace(/=s\d+/, '=s1000');
                        }
                        links.add(cleanUrl);
                    }
                }
            });
            return Array.from(links).slice(0, 15);
        });
    } catch (e) {
        return [];
    }
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

            const myTurn = (providerGlobalIndex % TOTAL_WORKERS === WORKER_ID);
            providerGlobalIndex++;
            if (!myTurn) continue;

            const mobile = p.id.split('_')[1] || "N/A";
            let cleanName = p.businessName.split('|')[0].split(',')[0].trim();

            const lastChecked = refreshRegistry[mobile] || 0;
            const needsCheck = (Date.now() - lastChecked > THIRTY_DAYS_MS);

            if (!needsCheck) {
                console.log(`  ⏭️ [FAST SKIP] ${cleanName} (${mobile}) - Checked recently.`);
                continue;
            }

            let broken = await isUrlBroken(p.profilePhotoUrl);
            if (!broken && Array.isArray(p.portfolioUrls) && p.portfolioUrls.length > 0) {
                for (let i = 0; i < Math.min(p.portfolioUrls.length, 3); i++) {
                    if (await isUrlBroken(p.portfolioUrls[i])) {
                        console.log(`  🔍 [CHECK] Portfolio item broken. Refreshing...`);
                        broken = true;
                        break;
                    }
                }
            }

            if (!broken) {
                console.log(`✅ Provider: ${cleanName} | 📱 ${mobile} | Status: ALL OK`);
                refreshRegistry[mobile] = Date.now();
                saveRegistry();
                continue;
            }

            console.log(`\n🚨 Provider: ${cleanName} | 📱 ${mobile} | Status: REFRESH NEEDED`);

            const query = `${cleanName}, ${p.fullAddress || (p.locality + ", " + p.city)}`;
            try {
                process.stdout.write(`  🔍 Searching Maps... `);
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
                console.log("Done.");

                const consent = await page.$('button[aria-label*="Accept"], button[aria-label*="Agree"], button[aria-label*="स्वीकार"]');
                if (consent) { await consent.click(); await page.waitForTimeout(2000); }

                const results = await page.$$('a.hfpxzc, div.m67q60 button');
                if (results.length > 0) {
                    console.log(`  🖱️ Found ${results.length} results. Checking each...`);
                    let matched = false;
                    for (let i = 0; i < Math.min(results.length, 5); i++) {
                        console.log(`    👉 Checking Result #${i+1}...`);
                        await results[i].click();
                        await page.waitForTimeout(4000);
                        if (await verifyPhoneNumber(page, mobile)) {
                            matched = true; break;
                        }
                    }
                    if (!matched) {
                        console.log(`  ❌ MISMATCH: Skipping.`);
                        refreshRegistry[mobile] = Date.now();
                        saveRegistry();
                        continue;
                    }
                } else {
                    console.log(`  🔍 Direct result. Verifying...`);
                    if (!(await verifyPhoneNumber(page, mobile))) {
                        console.log(`  ❌ MISMATCH: Skipping.`);
                        refreshRegistry[mobile] = Date.now();
                        saveRegistry();
                        continue;
                    }
                }

                process.stdout.write(`  📸 Extracting Portfolio... `);
                let portfolio = await extractPortfolio(page);
                console.log(`${portfolio.length} images found.`);

                if (portfolio.length > 0) {
                    const freshHeroUrl = portfolio[0].split('=')[0] + '=w500-h500-k-no';
                    const portfolioString = portfolio.join(',');

                    console.log(`  ✨ SUCCESS: Found ${portfolio.length} fresh URLs!`);
                    console.log(`     🔗 Profile Photo: ${freshHeroUrl}`);
                    console.log(`     📂 Portfolio List:`);
                    portfolio.forEach((url, idx) => console.log(`        [${idx+1}] ${url}`));

                    updateBatch.push({
                        id: p.id,
                        name: p.businessName,
                        state: stateName, // 🚀 FOR ROUTING
                        profilePhotoUrl: freshHeroUrl,
                        portfolioUrls: portfolioString
                    });
                    p.profilePhotoUrl = freshHeroUrl;
                    p.portfolioUrls = portfolio;
                    fileChanged = true;

                    refreshRegistry[mobile] = Date.now();
                    saveRegistry();

                    if (updateBatch.length >= BATCH_SIZE) await flushBatch();
                } else {
                    console.log(`  ⚠️ WARNING: No images found.`);
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
    await fetchRoutingTable(); // 🚀 LOAD SATELLITE URLS
    const allFolders = fs.readdirSync(__dirname).filter(f => f.endsWith('_grids') && fs.lstatSync(path.join(__dirname, f)).isDirectory());

    if (TARGET_STATE) {
        const specificFolder = `${TARGET_STATE.toLowerCase().replace(/ /g, '_')}_grids`;
        if (allFolders.includes(specificFolder)) {
            await refreshImages(TARGET_STATE);
        } else {
            console.error(`❌ State folder not found: ${specificFolder}`);
        }
    } else {
        console.log(`🌐 Total States Found: ${allFolders.length}`);
        for (const folder of allFolders) {
            const stateName = folder.replace('_grids', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            await refreshImages(stateName);
        }
    }
    saveRegistry();
    await gitPush("Final");
    console.log(`\n🏁 REFRESH COMPLETE. Total Updated: ${totalUpdatedCount}`);
}

main().catch(console.error);
