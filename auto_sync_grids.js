/**
 * RAPIDHELP SMART DATA SYNC ROBOT (V4 - ULTRA DEDUPE)
 * 🛡️ STABILITY: Fixes Grid-ID Migration (Removes leads from old grids when coordinates change).
 * 🚀 PERFORMANCE: Parallel Grid Generation & Incremental Fetching.
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
    console.log(`🤖 MASTER ROBOT V4 | ${isFullSync ? 'FULL SYNC' : 'INCREMENTAL SYNC'}`);

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
        const gridDir = path.join(__dirname, `${stateName.toLowerCase().replace(/ /g, '_')}_grids`);
        if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });

        console.log(`🏙️ PROCESSING STATE: ${stateName}`);

        let allNewProviders = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            let finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=5000&nocache=true`;
            if (lastSyncTime > 0) finalUrl += `&since=${lastSyncTime}`;

            const resp = await axios.get(finalUrl, { timeout: 300000 });
            if (Array.isArray(resp.data)) {
                allNewProviders.push(...resp.data);
                if (resp.data.length < 5000) hasMore = false;
                else offset += resp.data.length;
            } else break;
        }

        if (allNewProviders.length > 0) {
            const newLeadsMap = {}; // gid -> leads
            const newLeadIds = new Set(allNewProviders.map(p => p.id));

            allNewProviders.forEach(p => {
                const gid = getGridId(p.latitude, p.longitude);
                if (gid) {
                    if (!newLeadsMap[gid]) newLeadsMap[gid] = [];
                    newLeadsMap[gid].push(p);
                }
            });

            // 🚀 ULTRA DEDUPE: Step 1 - Remove updated leads from ALL existing files in this state
            const gridFiles = fs.readdirSync(gridDir).filter(f => f.endsWith('.json'));
            console.log(`   🛡️ Cleaning ${newLeadIds.size} updated leads from existing ${gridFiles.length} grid files...`);

            gridFiles.forEach(file => {
                const filePath = path.join(gridDir, file);
                const gid = file.replace('.json', '');
                let gridData = JSON.parse(fs.readFileSync(filePath));

                const filteredData = gridData.filter(p => !newLeadIds.has(p.id));

                // Add new data if this is the target grid
                if (newLeadsMap[gid]) {
                    filteredData.push(...newLeadsMap[gid]);
                    delete newLeadsMap[gid]; // Mark as handled
                }

                if (filteredData.length === 0) fs.unlinkSync(filePath);
                else fs.writeFileSync(filePath, JSON.stringify(filteredData));
            });

            // Step 2 - Create new grid files for leftover handled leads
            Object.keys(newLeadsMap).forEach(gid => {
                const filePath = path.join(gridDir, `${gid}.json`);
                fs.writeFileSync(filePath, JSON.stringify(newLeadsMap[gid]));
            });

            console.log(`   ✨ State ${stateName} Synced: ${allNewProviders.length} leads.`);
        }
    }

    fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify({ timestamp: Date.now() }, null, 2));
    console.log(`🚀 SYNC COMPLETE!`);
}

startRobotSync().catch(err => { console.error(err); process.exit(1); });
