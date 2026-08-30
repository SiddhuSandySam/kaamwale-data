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
    console.log(`🤖 MASTER ROBOT V4.1 | ${isFullSync ? 'FULL SYNC 🌑' : 'INCREMENTAL SYNC 📡'}`);

    let lastSyncTime = 0;
    if (!isFullSync && fs.existsSync(LAST_SYNC_FILE)) {
        try { lastSyncTime = JSON.parse(fs.readFileSync(LAST_SYNC_FILE)).timestamp || 0; } catch (e) {}
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

        while (hasMore) {
            let finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=5000&nocache=true`;
            // Incremental sync uses 'since', Full sync gets everything
            if (lastSyncTime > 0 && !isFullSync) finalUrl += `&since=${lastSyncTime}`;

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

            // 🚀 BATCH WRITE
            if (isFullSync) {
                // If Full Sync, just write everything new
                Object.keys(newLeadsMap).forEach(gid => {
                    fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(newLeadsMap[gid]));
                });
            } else {
                // If Incremental, perform cleaning and merging
                const gridFiles = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));
                gridFiles.forEach(file => {
                    const filePath = path.join(gridDir, file);
                    const gid = file.replace('.json', '');
                    let gridData = JSON.parse(fs.readFileSync(filePath));
                    const filteredData = gridData.filter(p => !newLeadIds.has(p.id));
                    if (newLeadsMap[gid]) {
                        filteredData.push(...newLeadsMap[gid]);
                        delete newLeadsMap[gid];
                    }
                    if (filteredData.length === 0) fs.unlinkSync(filePath);
                    else fs.writeFileSync(filePath, JSON.stringify(filteredData));
                });
                Object.keys(newLeadsMap).forEach(gid => {
                    fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(newLeadsMap[gid]));
                });
            }
            console.log(`   ✨ State ${stateName} Synced: ${allNewProviders.length} leads.`);
        }
    }

    fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ timestamp: Date.now() }, null, 2));
    console.log(`🚀 MISSION ACCOMPLISHED!`);
}

startRobotSync().catch(err => { console.error(err); process.exit(1); });
