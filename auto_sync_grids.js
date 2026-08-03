const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MASTER ROBOT: Starting Smart Multi-State Sync...");
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
            const limit = 1000;
            let hasMore = true;
            let errorCount = 0;

            while (hasMore) {
                console.log(`  📡 [${stateName}] Fetching Offset ${offset}...`);
                try {
                    const finalUrl = `${stateUrl}?type=providers&offset=${offset}&limit=${limit}&nocache=true&cb=${Date.now()}`;
                    const resp = await axios.get(finalUrl, { timeout: 120000 });
                    const data = resp.data;

                    if (Array.isArray(data)) {
                        if (data.length > 0) {
                            allProviders.push(...data);
                            console.log(`  ✅ Success: ${allProviders.length} records collected.`);

                            if (data.length < limit) {
                                hasMore = false; // Last batch
                            } else {
                                offset += data.length;
                            }
                            errorCount = 0; // Reset errors on success
                            await new Promise(r => setTimeout(r, 800)); // Breathe
                        } else {
                            // 🚀 CORRECT LOGIC: Empty array is a valid end of data, NOT an error.
                            console.log("  🏁 End of data reached (Empty Array).");
                            hasMore = false;
                        }
                    } else if (data && data.error) {
                        console.error(`  ❌ Google Script Logic Error: ${data.error}`);
                        hasMore = false; // Stop this state
                    } else {
                        throw new Error("Received non-array response (HTML or Malformed JSON)");
                    }
                } catch (e) {
                    errorCount++;
                    const statusCode = e.response ? e.response.status : "TIMEOUT/NETWORK";
                    console.error(`  ❌ Batch Fail (Attempt ${errorCount}): ${e.message} [Status: ${statusCode}]`);

                    if (errorCount > 10) {
                        console.error(`  ‼️ Too many real errors. Skipping state ${stateName}.`);
                        hasMore = false;
                    } else {
                        console.log(`  ⏳ Retrying same offset ${offset} in 20s...`);
                        await new Promise(r => setTimeout(r, 20000));
                    }
                }
            }

            console.log(`📊 [${stateName}] Total Fetched: ${allProviders.length}`);

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
                }
            }
        }
        console.log(`\n🚀 SYNC COMPLETE!\n`);
    } catch (e) { console.error(`❌ FATAL GLOBAL ERROR: ${e.message}`); }
}
startRobotSync();
