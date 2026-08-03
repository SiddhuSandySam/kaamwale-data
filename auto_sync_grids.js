const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MASTER ROBOT: Starting Persistent Multi-State Sync...");
    try {
        console.log(`📡 Step 1: Fetching Master Config...`);
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`, { timeout: 90000 });
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

            let allProviders = [];
            let offset = 0;
            const limit = 1000; // 🚀 BACK TO STABLE 1000 for 75k+ rows
            let hasMore = true;
            let errorStreak = 0;

            while (hasMore) {
                console.log(`  📡 [${stateName}] Fetching Offset ${offset}...`);
                try {
                    const finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=${limit}&nocache=true&cb=${Date.now()}`;
                    const resp = await axios.get(finalUrl, { timeout: 120000 });
                    const data = resp.data;

                    if (Array.isArray(data) && data.length > 0) {
                        allProviders.push(...data);
                        console.log(`  ✅ Success: ${allProviders.length} records collected.`);

                        if (data.length < limit) {
                            hasMore = false;
                        } else {
                            offset += data.length;
                        }
                        errorStreak = 0; // Reset
                        await new Promise(r => setTimeout(r, 800)); // Breathe
                    } else {
                        // Empty array could be end of data or a glitch
                        if (allProviders.length > 50000 && errorStreak > 1) {
                            console.log("  🏁 End assumed.");
                            hasMore = false;
                        } else {
                            console.warn("  ⚠️ Received empty response. Retrying...");
                            errorStreak++;
                            await new Promise(r => setTimeout(r, 10000));
                        }
                    }
                } catch (e) {
                    errorStreak++;
                    console.error(`  ❌ Batch Fail: ${e.message}. Attempt ${errorStreak}...`);
                    console.log(`  ⏳ PERSISTENT RETRY: Trying same offset ${offset} again in 20s...`);
                    await new Promise(r => setTimeout(r, 20000));
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
                    console.log(`✨ [${stateName}] Success: ${validCount} valid leads saved.`);
                }
            }
        }
        console.log(`\n🚀 SYNC COMPLETE!\n`);
    } catch (e) { console.error(`❌ FATAL: ${e.message}`); }
}
startRobotSync();
