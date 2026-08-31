/**
 * RAPIDHELP SMART DATA SYNC ROBOT (V4.1 - FULL SYNC ENHANCED)
 * 🛡️ STABILITY: Fixes Full Sync folder refresh.
 * 🛡️ DEDUPE: Removes leads from old grids when coordinates change.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const LAST_SYNC_FILE = path.join(__dirname, 'last_sync.json');

const isFullSync = process.argv.includes('--full');

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 10)}_${Math.floor(lon * 10)}`;
}

async function startRobotSync() {
    const SYNC_START_TIME = Date.now();
    const LOOKBACK_BUFFER = 15 * 60 * 1000; // 🚀 15-minute safety net to prevent race conditions

    console.log(`🤖 MASTER ROBOT V4.2 | ${isFullSync ? 'FULL SYNC 🌑' : 'INCREMENTAL SYNC 📡'}`);

    let lastSyncTime = 0;
    if (!isFullSync && fs.existsSync(LAST_SYNC_FILE)) {
        try {
            const savedData = JSON.parse(fs.readFileSync(LAST_SYNC_FILE));
            lastSyncTime = savedData.timestamp || 0;
        } catch (e) {}
    }

    const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`, { timeout: 90000 });
    const appData = hubResp.data;
    if (!appData.stateUrls) throw new Error("Invalid Hub Data");

    const states = Object.keys(appData.stateUrls);
    for (const stateName of states) {
        const stateUrl = appData.stateUrls[stateName];
        const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
        const gridDir = path.join(__dirname, folderName);

        // 🚀 FULL SYNC SLATE CLEANING
        if (isFullSync && fs.existsSync(gridDir)) {
            console.log(`   🧹 [${stateName}] Cleaning old grids for fresh Full Sync...`);
            fs.rmSync(gridDir, { recursive: true, force: true });
        }
        if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });

        console.log(`🏙️ PROCESSING STATE: ${stateName}`);

        let allNewProviders = [];
        let offset = 0;
        let hasMore = true;

        // 🛡️ APPLY LOOKBACK BUFFER for incremental sync
        let effectiveSince = (lastSyncTime > 0 && !isFullSync) ? (lastSyncTime - LOOKBACK_BUFFER) : 0;
        if (effectiveSince < 0) effectiveSince = 0;

        while (hasMore) {
            let finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=5000&nocache=true`;
            if (effectiveSince > 0) finalUrl += `&since=${effectiveSince}`;

            const resp = await axios.get(finalUrl, { timeout: 300000 });
            if (Array.isArray(resp.data)) {
                allNewProviders.push(...resp.data);
                if (resp.data.length < 5000) hasMore = false;
                else offset += resp.data.length;
            } else break;
        }

        if (allNewProviders.length > 0) {
            const newLeadsMap = {};
            const newLeadIds = new Set(allNewProviders.map(p => p.id));

            allNewProviders.forEach(p => {
                const gid = getGridId(p.latitude, p.longitude);
                if (gid) {
                    if (!newLeadsMap[gid]) newLeadsMap[gid] = [];
                    newLeadsMap[gid].push(p);
                }
            });

            // 🚀 BATCH WRITE (With robust dedupe/merge)
            if (isFullSync) {
                Object.keys(newLeadsMap).forEach(gid => {
                    fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(newLeadsMap[gid]));
                });
            } else {
                const gridFiles = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));
                gridFiles.forEach(file => {
                    const filePath = path.join(gridDir, file);
                    const gid = file.replace('.json', '');
                    try {
                        let gridData = JSON.parse(fs.readFileSync(filePath));
                        // 🛡️ Remove existing version of updated leads
                        const filteredData = gridData.filter(p => !newLeadIds.has(p.id));
                        if (newLeadsMap[gid]) {
                            filteredData.push(...newLeadsMap[gid]);
                            delete newLeadsMap[gid];
                        }
                        if (filteredData.length === 0) fs.unlinkSync(filePath);
                        else fs.writeFileSync(filePath, JSON.stringify(filteredData));
                    } catch (e) { console.error(`   ⚠️ Grid Error [${file}]: ${e.message}`); }
                });
                // Write completely new grids discovered in this sync
                Object.keys(newLeadsMap).forEach(gid => {
                    fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(newLeadsMap[gid]));
                });
            }
            console.log(`   ✨ State ${stateName} Synced: ${allNewProviders.length} records updated.`);
        }
    }

    // 🚀 WATERMARK: Save the time sync STARTED, not finished, for zero gap.
    fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ timestamp: SYNC_START_TIME }, null, 2));
    console.log(`🚀 MISSION ACCOMPLISHED!`);
}

startRobotSync().catch(err => { console.error(err); process.exit(1); });
