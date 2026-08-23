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

// 🚀 UTILITIES
async function isUrlBroken(url) {
    if (!url || url.startsWith('data:')) return true;
    try {
        const response = await axios.get(url, { timeout: 5000, responseType: 'stream' });
        response.data.destroy(); // Fast check
        return response.status >= 400;
    } catch (e) {
        return true; // 403, 404, etc.
    }
}

async function verifyPhoneNumber(page, targetMobile) {
    try {
        const phoneBtn = await page.waitForSelector('button[data-item-id^="phone"]', { timeout: 5000 });
        if (!phoneBtn) return false;
        const phoneText = await phoneBtn.innerText();
        const cleanPhone = phoneText.replace(/[^0-9]/g, '').slice(-10);
        return cleanPhone === targetMobile.slice(-10);
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
    console.log(`🔄 REFRESH SESSION: ${stateName}`);
    console.log(`===============================================`);

    const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
    const gridDir = path.join(__dirname, folderName);
    if (!fs.existsSync(gridDir)) return console.error(`❌ Folder not found: ${folderName}`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    const files = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(gridDir, file);
        let providers = JSON.parse(fs.readFileSync(filePath));
        let fileChanged = false;

        for (let p of providers) {
            if (!p.id.startsWith('shadow_')) continue;

            const mobile = p.id.split('_')[1] || "N/A";

            // 🛡️ CHECK IF REFRESH NEEDED
            const broken = await isUrlBroken(p.profilePhotoUrl);
            if (!broken) {
                console.log(`  ⏭️ STATUS: URL WORKING for ${mobile}`);
                continue;
            }

            // 🛡️ SMART QUERY: Use Name + Full Address for 100% Accuracy
            let cleanName = p.businessName.split('|')[0].split(',')[0].trim();
            const query = `${cleanName}, ${p.fullAddress || (p.locality + ", " + p.city)}`;

            console.log(`\n🔍 Provider: ${cleanName} | 📱 Mobile: ${mobile} (URL Broken)`);

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 45000 });

                // 🛡️ Handle Consent
                const consent = await page.$('button[aria-label*="Accept"], button[aria-label*="Agree"], button[aria-label*="स्वीकार"]');
                if (consent) { await consent.click(); await page.waitForTimeout(2000); }

                // 🛡️ HANDLE RESULTS
                const results = await page.$$('a.hfpxzc, div.m67q60 button');
                if (results.length > 0) {
                    console.log(`  🖱️ Found ${results.length} results. Verifying mobile...`);
                    let matched = false;
                    for (let res of results) {
                        await res.click();
                        await page.waitForTimeout(2500);
                        if (await verifyPhoneNumber(page, mobile)) {
                            console.log(`  ✅ MATCH FOUND for ${mobile}`);
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        console.log(`  ❌ DATA MISMATCH: Mobile ${mobile} not found in search results.`);
                        continue;
                    }
                } else {
                    // Direct Place Sheet?
                    console.log(`  🔍 Direct result? Verifying mobile...`);
                    if (!(await verifyPhoneNumber(page, mobile))) {
                        console.log(`  ❌ DATA MISMATCH: Mobile ${mobile} doesn't match direct result.`);
                        continue;
                    }
                }

                // 📸 Portfolio Extraction (Multi-Worker Logic)
                let portfolio = await extractPortfolio(page);

                if (portfolio.length > 0) {
                    const freshHeroUrl = portfolio[0]; // First item as profile photo
                    const portfolioString = portfolio.join(',');
                    const oldPortfolioString = Array.isArray(p.portfolioUrls) ? p.portfolioUrls.join(',') : p.portfolioUrls;

                    if (freshHeroUrl !== p.profilePhotoUrl || portfolioString !== oldPortfolioString) {
                        console.log(`  [NEW URL] sapadla: ${freshHeroUrl.substring(0, 50)}...`);
                        updateBatch.push({ id: p.id, name: p.businessName, profilePhotoUrl: freshHeroUrl, portfolioUrls: portfolioString });
                        p.profilePhotoUrl = freshHeroUrl;
                        p.portfolioUrls = portfolio;
                        fileChanged = true;
                        if (updateBatch.length >= BATCH_SIZE) await flushBatch();
                    }
                } else { console.log(`  ⚠️ STATUS: NO IMAGES FOUND`); }

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
