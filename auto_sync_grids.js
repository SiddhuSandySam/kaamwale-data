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
    console.log("🚀 MASTER ROBOT: Starting Fast Sync (Batch: 5000)...");
    try {
        // Fetch Hub Data
        const hubResp = await axios.get(`${HUB_URL}?type=app_data`, { timeout: 60000 });
        if (hubResp.data) fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(hubResp.data));

        // Fetch Maharashtra Providers
        let allProviders = [];
        let offset = 0;
        const limit = 5000;
        let hasMore = true;

        while (hasMore) {
            console.log(`📡 Fetching Offset ${offset}...`);
            try {
                const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 120000 });
                const data = resp.data;
                if (Array.isArray(data) && data.length > 0) {
                    allProviders.push(...data);
                    console.log(`✅ Success: ${allProviders.length} collected.`);
                    if (data.length < limit) hasMore = false;
                    else offset += data.length;
                    // Wait 3s to let Google Script rest
                    await new Promise(r => setTimeout(r, 3000));
                } else { hasMore = false; }
            } catch (err) {
                console.warn(`⚠️ Error: ${err.message}. Retrying in 10s...`);
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        if (allProviders.length > 50000) {
            const gridData = {};
            allProviders.forEach(p => {
                const gid = getGridId(p.latitude, p.longitude);
                if (gid) { if (!gridData[gid]) gridData[gid] = []; gridData[gid].push(p); }
            });
            Object.keys(gridData).forEach(gid => fs.writeFileSync(path.join(GRID_DIR, `${gid}.json`), JSON.stringify(gridData[gid])));
            console.log("✨ ALL DATA UPDATED!");
        }
    } catch (e) { console.error(e.message); process.exit(1); }
}
startRobotSync();
