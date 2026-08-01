const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🚀 SETTINGS
const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const MAHARASHTRA_URL = "https://script.google.com/macros/s/AKfycbzbK2ij2FS5bQjWYgv3gYdyTohXlJsCQcOXrEn9TArWLTEh3kQU50zvTZa87w9tb2vM/exec";
const GRID_DIR = path.join(__dirname, 'maharashtra_grids');

if (!fs.existsSync(GRID_DIR)) fs.mkdirSync(GRID_DIR, { recursive: true });

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MASTER ROBOT: Starting Full Sync (Batch: 1000)");
    try {
        // Fetch Hub Data
        const hubResp = await axios.get(`${HUB_URL}?type=app_data`, { timeout: 60000 });
        if (hubResp.data) fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(hubResp.data));

        // Fetch Maharashtra Providers
        let allProviders = [];
        let offset = 0;
        const limit = 1000; // 🚀 BACK TO 1000: Proven stability for 70k+ rows
        let hasMore = true;
        let emptyRetry = 0;

        while (hasMore) {
            console.log(`📡 Fetching Offset ${offset}...`);
            try {
                const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 120000 });
                const data = resp.data;

                if (Array.isArray(data) && data.length > 0) {
                    allProviders.push(...data);
                    console.log(`✅ Success: ${allProviders.length} records collected.`);
                    if (data.length < limit) hasMore = false;
                    else offset += data.length;
                    emptyRetry = 0;
                    await new Promise(r => setTimeout(r, 800)); // 0.8s break
                } else {
                    if (emptyRetry < 2) {
                        emptyRetry++;
                        console.warn(`⚠️ Empty batch at ${offset}. Retry ${emptyRetry}...`);
                        await new Promise(r => setTimeout(r, 5000));
                    } else {
                        hasMore = false;
                    }
                }
            } catch (err) {
                console.error(`❌ Batch Fail: ${err.message}. Retrying...`);
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        console.log(`📊 FINAL SYNC STATS: Total = ${allProviders.length}`);

        if (allProviders.length > 50000) {
            const gridData = {};
            allProviders.forEach(p => {
                const gid = getGridId(p.latitude, p.longitude);
                if (gid) { if (!gridData[gid]) gridData[gid] = []; gridData[gid].push(p); }
            });
            Object.keys(gridData).forEach(gid => fs.writeFileSync(path.join(GRID_DIR, `${gid}.json`), JSON.stringify(gridData[gid])));
            console.log("✨ ALL DATA UPDATED AND LIVE ON CDN!");
        } else {
            console.error("⚠️ DATA TOO SMALL! Sync aborted to protect production.");
        }
    } catch (e) { console.error(e.message); process.exit(1); }
}
startRobotSync();
