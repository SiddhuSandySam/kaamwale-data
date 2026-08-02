const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MASTER ROBOT: Starting Multi-State Sync with Debug Mode...");
    try {
        console.log(`📡 Step 1: Fetching Master Config...`);
        const hubResp = await axios.get(`${HUB_URL}?type=app_data`, { timeout: 90000 });
        const appData = hubResp.data;
        if (!appData || !appData.stateUrls) throw new Error("Invalid Hub Data");

        fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(appData));
        console.log("✅ Hub Config Saved.");

        const states = Object.keys(appData.stateUrls);
        for (const stateName of states) {
            const stateUrl = appData.stateUrls[stateName];
            const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
            const gridDir = path.join(__dirname, folderName);

            console.log(`\n🏙️  PROCESSING STATE: ${stateName}`);
            console.log(`🔗 TARGET URL: ${stateUrl}`);

            let allProviders = [];
            let offset = 0;
            const limit = 5000;
            let hasMore = true;

            while (hasMore) {
                try {
                    // 🚀 CACHE BUSTER: Added timestamp to force fresh data from Google
                    const finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=${limit}&cb=${Date.now()}`;
                    const resp = await axios.get(finalUrl, { timeout: 120000 });
                    const data = resp.data;

                    if (Array.isArray(data) && data.length > 0) {
                        allProviders.push(...data);

                        // 🔍 DEBUG LOG: Show what we actually got
                        if (offset === 0) {
                            console.log(`  🕵️ DEBUG: First record received for ${stateName} is from state: "${data[0].state}" and city: "${data[0].city}"`);
                        }

                        console.log(`  ✅ Success: ${allProviders.length} records collected.`);
                        if (data.length < limit) hasMore = false;
                        else offset += data.length;
                    } else {
                        hasMore = false;
                    }
                } catch (e) {
                    console.error(`  ⚠️ Batch Fail for ${stateName}: ${e.message}`);
                    hasMore = false;
                }
            }

            if (allProviders.length > 0) {
                const gridData = {};
                let validCount = 0;
                allProviders.forEach(p => {
                    if (p.state && p.state.toLowerCase() === stateName.toLowerCase()) {
                        const gid = getGridId(p.latitude, p.longitude);
                        if (gid) {
                            if (!gridData[gid]) gridData[gid] = [];
                            gridData[gid].push(p);
                            validCount++;
                        }
                    }
                });

                if (validCount > 0) {
                    if (!fs.existsSync(gridDir)) fs.mkdirSync(gridDir, { recursive: true });
                    Object.keys(gridData).forEach(gid => {
                        fs.writeFileSync(path.join(gridDir, `${gid}.json`), JSON.stringify(gridData[gid]));
                    });
                    console.log(`✨ [${stateName}] Success: ${validCount} leads saved.`);
                } else {
                    console.warn(`  ⚠️ REJECTED: All ${allProviders.length} records received from this URL belong to "${allProviders[0].state}", not "${stateName}"!`);
                }
            }
        }
        console.log(`\n🚀 SYNC COMPLETE!\n`);
    } catch (e) { console.error(`❌ FATAL ERROR: ${e.message}`); }
}
startRobotSync();
