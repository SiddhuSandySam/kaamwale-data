const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MULTI-STATE MASTER ROBOT: Starting...");
    try {
        console.log("📡 Fetching Master Config...");
        const hubResp = await axios.get(`${HUB_URL}?type=app_data`, { timeout: 60000 });
        const appData = hubResp.data;
        if (!appData || !appData.stateUrls) throw new Error("Invalid Hub Data");

        fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(appData));
        console.log("✅ Hub Config Updated.");

        const states = Object.keys(appData.stateUrls);
        for (const stateName of states) {
            const stateUrl = appData.stateUrls[stateName];
            const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
            const gridDir = path.join(__dirname, folderName);

            console.log(`📡 Processing State: ${stateName}...`);

            let allProviders = [];
            let offset = 0;
            const limit = 5000;
            let hasMore = true;

            while (hasMore) {
                try {
                    const resp = await axios.get(`${stateUrl}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 120000 });
                    const data = resp.data;

                    if (data && data.error) {
                        console.error(`  ❌ Google Script Error in ${stateName}: ${data.error}`);
                        hasMore = false;
                        continue;
                    }

                    if (Array.isArray(data) && data.length > 0) {
                        allProviders.push(...data);
                        console.log(`  ✅ ${allProviders.length} leads collected for ${stateName}.`);
                        if (data.length < limit) hasMore = false;
                        else offset += data.length;
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        hasMore = false;
                    }
                } catch (e) {
                    console.warn(`  ⚠️ Connection Error for ${stateName}: ${e.message}`);
                    hasMore = false;
                }
            }

            if (allProviders.length > 0) {
                if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });
                const gridData = {};
                allProviders.forEach(p => {
                    const gid = getGridId(p.latitude, p.longitude);
                    if (gid) { if (!gridData[gid]) gridData[gid] = []; gridData[gid].push(p); }
                });
                Object.keys(gridData).forEach(gid => {
                    fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(gridData[gid]));
                });
                console.log(`✨ ${stateName} Success: ${Object.keys(gridData).length} grids updated.`);
            } else {
                console.log(`  ℹ️ Skipping ${stateName}: No leads found.`);
            }
        }
        console.log("🚀 SYNC CYCLE COMPLETE!");
    } catch (e) { console.error("❌ FATAL:", e.message); process.exit(1); }
}
startRobotSync();
