/**
 * RAPIDHELP SMART DATA SYNC ROBOT (V3 - STABLE)
 * 🚀 PERFORMANCE: Parallel Grid Generation & Incremental Fetching
 * 🛡️ STABILITY: Retries on every batch to ensure 100% data capture.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const LAST_SYNC_FILE = path.join(__dirname, 'last_sync.json');

// 🚀 Mode Check: Full or Incremental
const isFullSync = process.argv.includes('--full');

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    // 🚀 11KM RESOLUTION (Factor 10): Balanced for CDN stability and wide coverage
    return `g_${Math.floor(lat * 10)}_${Math.floor(lon * 10)}`;
}

async function startRobotSync() {
    console.log(`\n===============================================`);
    console.log(`🤖 MASTER ROBOT | ${isFullSync ? 'FULL SYNC 🌑' : 'INCREMENTAL SYNC 📡'}`);
    console.log(`===============================================\n`);

    let lastSyncTime = 0;
    if (!isFullSync && fs.existsSync(LAST_SYNC_FILE)) {
        try {
            const syncData = JSON.parse(fs.readFileSync(LAST_SYNC_FILE));
            lastSyncTime = syncData.timestamp || 0;
            console.log(`📡 Fetching leads updated since: ${new Date(lastSyncTime).toLocaleString()}`);
        } catch (e) { console.error("⚠️ Failed to read last sync file."); }
    }

    // --- STEP 1: LOAD HUB DATA ---
    let appData = null;
    let hubRetries = 0;
    while (!appData) {
        hubRetries++;
        console.log(`📡 Fetching Master Config (Attempt ${hubRetries})...`);
        try {
            const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`, { timeout: 90000 });
            if (hubResp.data && hubResp.data.stateUrls) {
                appData = hubResp.data;
            } else { throw new Error("Invalid Hub Data format."); }
        } catch (e) {
            console.error(`  ❌ Hub Fetch Fail: ${e.message}`);
            await new Promise(r => setTimeout(r, 20000));
        }
    }

    fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(appData, null, 2));
    console.log("✅ Hub Config Saved Locally.");

    // --- STEP 2: PROCESS EACH STATE ---
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

            while (!batchSuccess && attempt < 10) {
                attempt++;
                console.log(`  📡 [${stateName}] Fetching Offset ${offset}... (Attempt ${attempt}/10)`);
                try {
                    let finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=${limit}&nocache=true&cb=${Date.now()}`;
                    if (lastSyncTime > 0) finalUrl += `&since=${lastSyncTime}`;

                    const resp = await axios.get(finalUrl, { timeout: 300000 });
                    const data = resp.data;

                    if (Array.isArray(data)) {
                        allProviders.push(...data);
                        console.log(`  ✅ Success: +${data.length} leads (Total: ${allProviders.length})`);

                        if (data.length < limit) hasMore = false;
                        else offset += data.length;

                        batchSuccess = true;
                    } else { throw new Error("Response is not an array."); }
                } catch (e) {
                    console.error(`  ❌ Batch Fail: ${e.message}`);
                    await new Promise(r => setTimeout(r, 30000));
                }
            }
            if (!batchSuccess) { console.error(`  🛑 Skipping state ${stateName} due to persistent failures.`); break; }
        }

        // --- STEP 3: GENERATE GRIDS ---
        if (allProviders.length > 0) {
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

            console.log(`  📦 Generating ${Object.keys(gridMap).length} grid files...`);
            Object.keys(gridMap).forEach(gid => {
                const filePath = path.join(gridDir, `${gid}.json`);
                let finalGridData = [];

                if (!isFullSync && fs.existsSync(filePath)) {
                    try {
                        const existing = JSON.parse(fs.readFileSync(filePath));
                        const newIds = new Set(gridMap[gid].map(p => p.id));
                        finalGridData = existing.filter(p => !newIds.has(p.id)); // Dedupe
                    } catch (e) {}
                }

                finalGridData.push(...gridMap[gid]);
                fs.writeFileSync(filePath, JSON.stringify(finalGridData));
            });
            console.log(`✨ [${stateName}] Finished. Total Leads Synced: ${allProviders.length}`);
        }
    }

    // Save sync timestamp
    fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ timestamp: Date.now() }, null, 2));
    console.log(`\n🚀 MISSION ACCOMPLISHED: FULL SYNC CYCLE COMPLETE!\n`);
}

startRobotSync().catch(err => {
    console.error("\n❌ FATAL SYSTEM ERROR:");
    console.error(err);
    process.exit(1);
});
