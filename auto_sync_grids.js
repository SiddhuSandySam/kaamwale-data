const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🚀 MASTER HUB URL
const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MULTI-STATE MASTER ROBOT: Starting...");
    try {
        // Step 1: Fetch Hub Data (Config/URLs)
        console.log("📡 Step 1: Fetching Master Config...");
        const hubResp = await axios.get(`${HUB_URL}?type=app_data`, { timeout: 60000 });
        const appData = hubResp.data;
        if (!appData || !appData.stateUrls) throw new Error("Invalid Hub Data");

        fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(appData));
        console.log("✅ Hub Config Updated.");

        // Step 2: Loop through each State defined in Hub
        const states = Object.keys(appData.stateUrls);
        for (const stateName of states) {
            const stateUrl = appData.stateUrls[stateName];
            const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
            const gridDir = path.join(__dirname, folderName);

            console.log(`📡 Processing State: ${stateName} (${folderName})...`);
            if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });

            let allProviders = [];
            let offset = 0;
            const limit = 5000;
            let hasMore = true;

            while (hasMore) {
                console.log(`  🔍 Fetching ${stateName} | Offset: ${offset}...`);
                try {
                    const resp = await axios.get(`${stateUrl}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 120000 });
                    const data = resp.data;
                    if (Array.isArray(data) && data.length > 0) {
                        allProviders.push(...data);
                        console.log(`  ✅ ${allProviders.length} leads collected.`);
                        if (data.length < limit) hasMore = false;
                        else offset += data.length;
                        await new Promise(r => setTimeout(r, 2000)); // 2s break to prevent rate limits
                    } else { hasMore = false; }
                } catch (e) {
                    console.warn(`  ⚠️ Batch Fail: ${e.message}. Retrying...`);
                    await new Promise(r => setTimeout(r, 10000));
                }
            }

            // Step 3: Split into Grids for this State
            if (allProviders.length > 0) {
                const gridData = {};
                allProviders.forEach(p => {
                    const gid = getGridId(p.latitude, p.longitude);
                    if (gid) { if (!gridData[gid]) gridData[gid] = []; gridData[gid].push(p); }
                });
                Object.keys(gridData).forEach(gid => {
                    fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(gridData[gid]));
                });
                console.log(`✨ ${stateName} Updated: ${Object.keys(gridData).length} grids.`);
            }
        }
        console.log("🚀 ALL STATES SYNCED SUCCESSFULLY!");
    } catch (e) { console.error("❌ FATAL:", e.message); process.exit(1); }
}
startRobotSync();
