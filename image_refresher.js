const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
let stateUrls = {};

async function fetchRoutingTable() {
    try {
        const response = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        stateUrls = response.data.stateUrls;
    } catch (e) { console.log("Routing Table Fail."); }
}

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(5000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) { for (let i = 0; i < 6; i++) { gallery.scrollBy(0, 1500); await new Promise(r => setTimeout(r, 600)); } }
            });
            await page.waitForTimeout(2000);
        }

        return await page.evaluate(() => {
            const baseLinks = new Set();
            document.querySelectorAll('img, div[style*="background-image"]').forEach(el => {
                let src = el.tagName === 'IMG' ? el.src : (el.style.backgroundImage.match(/url\(["']?([^"']+)["']?\)/) || [])[1];
                if (src && src.includes('googleusercontent.com') && !src.includes('/a/')) {
                    baseLinks.add(src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(baseLinks).map(base => `${base}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function sendWithRetry(url, payload, providerName) {
    let success = false;
    let attempt = 0;
    while (!success && attempt < 10) {
        attempt++;
        console.log(`[Attempt ${attempt}] Sending ${providerName} to Hub...`);
        try {
            const response = await axios.post(url, payload, { timeout: 60000 });
            const resData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            console.log(`HUB Response: ${resData}`);

            if (resData.includes("Success")) {
                success = true;
                console.log(`✅ ${providerName} updated!`);
            } else {
                console.log(`⏳ Retrying in 10s...`);
                await new Promise(r => setTimeout(r, 10000));
            }
        } catch (err) {
            console.log(`❌ Error: ${err.message}. Retrying...`);
            await new Promise(r => setTimeout(r, 15000));
        }
    }
}

async function main() {
    await fetchRoutingTable();
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    const providers = [
        { id: "shadow_8007005398", name: "Shelke Plumbing", addr: "32F3+4XG Vashi-Turbhe gaw vashi Turbhe gaw, Sector 24 room n A14, Navi Mumbai, Maharashtra 400703" }
    ];

    for (let p of providers) {
        console.log(`\nTARGET: ${p.name}`);
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(p.name + ", " + p.addr)}`);
        await page.waitForTimeout(4000);

        const results = await page.$$('a.hfpxzc, div.m67q60 button');
        if (results.length > 0) { await results[0].click(); await page.waitForTimeout(4000); }

        let portfolio = await extractPortfolio(page);
        if (portfolio.length > 0) {
            const freshHeroUrl = portfolio[0].split('=')[0] + '=w500-h500-k-no';
            const targetHub = stateUrls["Maharashtra"] || HUB_URL;

            console.log(`Found ${portfolio.length} images.`);

            // 🚀 UNIVERSAL PAYLOAD: Works with V67, V70, and Hub-wrapped requests
            const payload = {
                type: "BATCH_IMAGE_UPDATE",
                state: "Maharashtra",
                // Top-level fields (V67 fallback)
                id: String(p.id),
                profilePhotoUrl: freshHeroUrl,
                portfolioUrls: portfolio.join(','),
                // Array fields (V70 / Hub-compatible)
                updates: [{
                    id: String(p.id),
                    profilePhotoUrl: freshHeroUrl,
                    portfolioUrls: portfolio.join(',')
                }]
            };

            console.log(`Sending to: ${targetHub}`);
            await sendWithRetry(targetHub, payload, p.name);
        }
    }
    await browser.close();
}

main().catch(console.error);
