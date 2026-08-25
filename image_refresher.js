const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * ULTRA-ROBUST ON-DEMAND REFRESHER (V103 - MULTI-WORKER QUEUE MODE)
 * Distributed tasks among workers to prevent redundant work.
 */
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[W${WORKER_ID}] [${timestamp}] ${msg}`);
}

async function extractPhone(page) {
    const selectors = [
        'button[data-item-id^="phone"]',
        'button[aria-label*="Phone"]',
        'button[aria-label*="फोन"]',
        '.CsEnBe[aria-label*="Phone"]'
    ];
    for (let sel of selectors) {
        try {
            const text = await page.$eval(sel, el => el.innerText || el.getAttribute('aria-label') || "");
            if (text) {
                const clean = text.replace(/[^0-9]/g, '').slice(-10);
                if (clean.length === 10) return clean;
            }
        } catch (e) {}
    }
    return "";
}

async function extractPortfolio(page) {
    try {
        const photoGalleryBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoGalleryBtn) {
            await photoGalleryBtn.click();
            await page.waitForTimeout(5000);
            await page.evaluate(async () => {
                const gallery = document.querySelector('div[role="main"], div[role="grid"], .m67q60');
                if (gallery) { for (let i = 0; i < 4; i++) { gallery.scrollBy(0, 1500); await new Promise(r => setTimeout(r, 600)); } }
            });
            await page.waitForTimeout(2000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img, div[style*="background-image"]').forEach(el => {
                let src = el.tagName === 'IMG' ? el.src : (el.style.backgroundImage.match(/url\(["']?([^"']+)["']?\)/) || [])[1];
                if (src && src.includes('googleusercontent.com') && !src.includes('/a/')) {
                    links.add(src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function sendRequestWithRetry(payload, label, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const resp = await axios.post(HUB_URL, payload, { timeout: 120000 });
            return resp.data;
        } catch (e) {
            writeLog(`⚠️ [ERROR] ${label} failed: ${e.message}. Retrying...`);
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

async function runWorker() {
    writeLog("🚀 CHECKING REFRESH QUEUE...");
    try {
        const allTasks = await sendRequestWithRetry({ type: "GET_REFRESH_QUEUE" }, "Fetch Tasks");

        if (!Array.isArray(allTasks) || allTasks.length === 0) {
            writeLog("✅ No pending tasks found. Shutting down.");
            return;
        }

        // 🚀 DISTRIBUTE TASKS: Filter tasks based on worker ID
        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);

        if (myTasks.length === 0) {
            writeLog("💤 No tasks assigned to this worker. Sleeping.");
            return;
        }

        writeLog(`🔥 Processing ${myTasks.length} assigned tasks. Starting Browser...`);
        const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
        const page = await browser.newPage();

        for (const task of myTasks) {
            writeLog(`\n--- TARGET: ${task.name} ---`);
            const dbPhone = String(task.id).replace('shadow_', '');

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);

                const mapsPhone = await extractPhone(page);
                writeLog(`📱 Maps: [${mapsPhone}] | DB: [${dbPhone}]`);

                if (mapsPhone === dbPhone) {
                    writeLog("✅ Phone Matched! Extracting photos...");
                    let portfolio = await extractPortfolio(page);

                    if (portfolio.length > 0) {
                        const syncPayload = {
                            type: "BATCH_IMAGE_UPDATE",
                            state: task.state,
                            updates: [{
                                id: String(task.id),
                                profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                                portfolioUrls: portfolio.join(',')
                            }]
                        };

                        const res = await sendRequestWithRetry(syncPayload, `Sync ${task.name}`);
                        if (String(res).includes("Success")) {
                            writeLog(`🎉 Sheet updated!`);
                            await sendRequestWithRetry({ type: "MARK_REFRESH_DONE", row: task.row }, "Mark DONE");
                        }
                    } else {
                        writeLog("⚠️ No photos found.");
                        await sendRequestWithRetry({ type: "MARK_REFRESH_DONE", row: task.row }, "Cleanup (No Photos)");
                    }
                } else {
                    writeLog(`❌ SKIP: Phone mismatch.`);
                    await sendRequestWithRetry({ type: "MARK_REFRESH_DONE", row: task.row }, "Cleanup (Mismatch)");
                }
            } catch (err) { writeLog(`❌ Error: ${err.message}`); }
        }

        await browser.close();
        writeLog("\n🏁 Assigned tasks completed.");
    } catch (e) { writeLog(`❌ FATAL: ${e.message}`); }
}

runWorker();
