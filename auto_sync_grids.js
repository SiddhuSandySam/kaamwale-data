const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const LAST_SYNC_FILE = path.join(__dirname, 'last_sync.json');

// 🚀 Mode Check: Full or Incremental
const isFullSync = process.argv.includes('--full');

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log(`🤖 MASTER ROBOT: Starting ${isFullSync ? 'FULL' : 'INCREMENTAL'} Multi-State Sync...`);

    let lastSyncTime = 0;
    if (!isFullSync && fs.existsSync(LAST_SYNC_FILE)) {
        try {
            const syncData = JSON.parse(fs.readFileSync(LAST_SYNC_FILE));
            lastSyncTime = syncData.timestamp || 0;
            console.log(`📡 Syncing leads since: ${new Date(lastSyncTime).toLocaleString()}`);
        } catch (e) {}
    }

    let appData = null;
    let hubRetries = 0;
    while (!appData) {
        hubRetries++;
        console.log(`📡 Step 1: Fetching Master Config (Attempt ${hubRetries})...`);
        try {
            const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`, { timeout: 90000 });
            if (hubResp.data && hubResp.data.stateUrls) {
                appData = hubResp.data;
            } else { throw new Error("Invalid Hub Data."); }
        } catch (e) {
            console.error(`  ❌ Hub Fetch Fail: ${e.message}`);
            await new Promise(r => setTimeout(r, 20000));
        }
    }

    try {
        fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(appData));
        const states = Object.keys(appData.stateUrls);

        for (const stateName of states) {
            const stateUrl = appData.stateUrls[stateName];
            const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
            const gridDir = path.join(__dirname, folderName);

            console.log(`\n🏙️  PROCESSING STATE: ${stateName}`);

            let allProviders = [];
            let offset = 0;
            const limit = 5000;
            let hasMore = true;

            while (hasMore) {
                let batchSuccess = false;
                let attempt = 0;

                while (!batchSuccess) {
                    attempt++;
                    console.log(`  📡 [${stateName}] Fetching Offset ${offset}... (Attempt ${attempt})`);
                    try {
                        // 🚀 INCREMENTAL FETCH: Only ask for data since lastSyncTime
                        let finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=${limit}&nocache=true&cb=${Date.now()}`;
                        if (lastSyncTime > 0) finalUrl += `&since=${lastSyncTime}`;

                        const resp = await axios.get(finalUrl, { timeout: 150000 });
                        const data = resp.data;

                        if (Array.isArray(data)) {
                            allProviders.push(...data);
                            console.log(`  ✅ Success: ${data.length} records (Total: ${allProviders.length})`);

                            if (data.length < limit) hasMore = false;
                            else offset += data.length;

                            batchSuccess = true;
                            await new Promise(r => setTimeout(r, 1000));
                        } else {
                            throw new Error(`Invalid Response Format (Not an array)`);
                        }
                    } catch (e) {
                        const status = e.response ? e.response.status : "TIMEOUT/NETWORK";
                        console.error(`  ❌ Batch Fail [Status: ${status}]: ${e.message}`);
                        console.log(`  ⏳ Persistent Retry: Retrying offset ${offset} in 30s...`);
                        await new Promise(r => setTimeout(r, 30000));
                    }
                }
            }

            if (allProviders.length > 0) {
                // 🚀 FULL SYNC FRESH START: Clear directory to remove stale grids
                if (isFullSync && fs.existsSync(gridDir)) {
                    console.log(`  🧹 [${stateName}] Cleaning old grids for fresh sync...`);
                    fs.rmSync(gridDir, { recursive: true, force: true });
                }

                if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });

                const gridMap = {};
                allProviders.forEach(p => {
                    const gid = getGridId(p.latitude, p.longitude);
                    if (gid) {
                        if (!gridMap[gid]) gridMap[gid] = [];
                        gridMap[gid].push(p);
                    }
                });

                Object.keys(gridMap).forEach(gid => {
                    const filePath = path.join(gridDir, `${gid}.json`);
                    let existingData = [];

                    // 🚀 MERGE LOGIC: If incremental, load old file and add new data
                    if (!isFullSync && fs.existsSync(filePath)) {
                        try {
                            existingData = JSON.parse(fs.readFileSync(filePath));
                            const newIds = new Set(gridMap[gid].map(p => p.id));
                            existingData = existingData.filter(p => !newIds.has(p.id)); // Remove old versions
                        } catch (e) {}
                    }

                    const finalData = [...existingData, ...gridMap[gid]];
                    fs.writeFileSync(filePath, JSON.stringify(finalData));
                });
                console.log(`✨ [${stateName}] Success: ${allProviders.length} leads synced.`);
            }
        }

        // 🚀 Update last sync timestamp
        fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ timestamp: Date.now() }));
        console.log(`\n🚀 FULL SYNC CYCLE COMPLETE!\n`);
    } catch (e) { console.error(`❌ FATAL: ${e.message}`); }
}
startRobotSync();
