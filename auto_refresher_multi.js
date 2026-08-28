const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/**
 * 🎯 ON-DEMAND IMAGE REFRESHER (STRICT QUEUE MODE)
 * Only processes what's in 'RefreshQueue' sheet.
 */
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const LOG_FILE = path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`);

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    fs.appendFileSync(LOG_FILE, logMsg);
}

let stateUrls = {};

async function extractPortfolio(page) {
    try {
        await page.evaluate(async () => {
            const panel = document.querySelector('div[role="main"], div[role="dialog"]');
            if (panel) { panel.scrollBy(0, 1000); await new Promise(r => setTimeout(r, 500)); }
        });
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(img => {
                const src = img.src || "";
                if (src.includes('googleusercontent.com') && !src.includes('/a/')) {
                    links.add(src.split('=')[0].split('/s')[0]);
                }
            });
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 15);
        });
    } catch (e) { return []; }
}

async function markAsDone(id) {
    try {
        await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", id: id });
        writeLog(`🧹 QUEUE CLEANED: ${id} removed.`);
    } catch (e) { writeLog(`⚠️ Queue removal failed for ${id}: ${e.message}`); }
}

async function runWorker() {
    writeLog(`🚀 Worker Starting... (Partition: ${WORKER_ID}/${TOTAL_WORKERS})`);

    try {
        // 1. Load Routing Table (State URLs) Once
        writeLog("📥 Fetching routing table...");
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        stateUrls = hubResp.data.stateUrls || {};

        // 2. Fetch Active Tasks from Queue
        writeLog("📥 Fetching tasks from RefreshQueue...");
        const queueResp = await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" });
        const allTasks = Array.isArray(queueResp.data) ? queueResp.data : [];

        // 3. Filter for this worker
        const myTasks = allTasks.filter((task, index) => index % TOTAL_WORKERS === WORKER_ID);
        writeLog(`📋 Task Distribution: My Work = ${myTasks.length} / Total = ${allTasks.length}`);

        if (myTasks.length === 0) {
            writeLog("✅ QUEUE EMPTY. No actions needed. Worker exiting.");
            return;
        }

        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();

        for (const task of myTasks) {
            const dbPhone = String(task.id).replace('shadow_', '');
            writeLog(`\n🔍 SCANNING: ${task.name} (${dbPhone}) in ${task.addr}`);

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });

                const status = await Promise.race([
                    page.waitForSelector('a.hfpxzc', { timeout: 12000 }).then(() => "LIST").catch(() => null),
                    page.waitForSelector('button[data-item-id^="phone"]', { timeout: 12000 }).then(() => "SINGLE").catch(() => null)
                ]);

                let matched = false;
                if (status === "SINGLE") {
                    matched = await checkAndSync(page, task, dbPhone);
                } else if (status === "LIST") {
                    writeLog(`📋 List View Found. Checking top 5 results...`);
                    const listings = await page.$$('a.hfpxzc');
                    for (let j = 0; j < Math.min(listings.length, 5); j++) {
                        await listings[j].click();
                        await page.waitForTimeout(2500); // Wait for info panel to slide in
                        if (await checkAndSync(page, task, dbPhone)) {
                            matched = true; break;
                        }
                    }
                }

                if (matched) {
                    await markAsDone(task.id);
                } else {
                    writeLog(`❌ FAILED: Phone number mismatch or profile not found for ${task.name}`);
                }
            } catch (err) {
                writeLog(`⚠️ Error processing ${task.name}: ${err.message}`);
            }
        }
        await browser.close();
        writeLog("\n🏁 WORKER JOB COMPLETED.");
    } catch (e) {
        writeLog(`❌ FATAL ERROR: ${e.message}`);
    }
}

async function checkAndSync(page, task, dbPhone) {
    try {
        await page.waitForSelector('button[data-item-id^="phone"]', { timeout: 5000 }).catch(() => {});
        const mapsPhone = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
        const cleanMapsPhone = mapsPhone.replace(/[^0-9]/g, '').slice(-10);

        if (cleanMapsPhone === dbPhone) {
            const portfolio = await extractPortfolio(page);
            if (portfolio.length > 0) {
                const payload = {
                    type: "IMAGE_UPDATE",
                    id: task.id,
                    state: task.state,
                    profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                    portfolioUrls: portfolio.join(',')
                };

                const targetUrl = stateUrls[task.state] || HUB_URL;
                const resp = await axios.post(targetUrl, payload, { timeout: 30000 });

                if (String(resp.data).includes("Success")) {
                    writeLog(`✅ SYNC SUCCESS: Images updated for ${task.name}`);
                    return true;
                } else {
                    writeLog(`⚠️ HUB REJECTED: ${resp.data}`);
                }
            } else {
                writeLog(`⚠️ NO PHOTOS: Found profile but no images for ${task.name}`);
            }
        } else {
            writeLog(`❌ PHONE MISMATCH: Found ${cleanMapsPhone || "none"} (Expected ${dbPhone})`);
        }
    } catch (e) { writeLog(`⚠️ Sync check failed: ${e.message}`); }
    return false;
}

runWorker();
