const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    return `g_${Math.floor(lat * 5)}_${Math.floor(lon * 5)}`;
}

async function startRobotSync() {
    console.log("🤖 MULTI-STATE MASTER ROBOT: Starting with Persistent Retries...");
    try {
        console.log(`📡 Step 1: Fetching Master Config from Hub...`);
        const hubResp = await axios.get(`${HUB_URL}?type=app_data`, { timeout: 90000 });
        const appData = hubResp.data;
        if (!appData || !appData.stateUrls) throw new Error("Invalid Hub Data received.");

        fs.writeFileSync(path.join(__dirname, 'hub_data.json'), JSON.stringify(appData));
        console.log("✅ Hub Config Updated and Saved.");

        const states = Object.keys(appData.stateUrls);
        for (const stateName of states) {
            const stateUrl = appData.stateUrls[stateName];
            const folderName = `${stateName.toLowerCase().replace(/ /g, '_')}_grids`;
            const gridDir = path.join(__dirname, folderName);

            console.log(`--------------------------------------------------`);
            console.log(`🏙️  STATE: ${stateName}`);
            console.log(`🔗 URL: ${stateUrl}`);
            console.log(`--------------------------------------------------`);

            let allProviders = [];
            let offset = 0;
            const limit = 1000;
            let hasMore = true;
            let errorStreak = 0;

            while (hasMore) {
                console.log(`  📡 [${stateName}] Fetching Offset ${offset}...`);
                try {
                    const resp = await axios.get(`${stateUrl}?type=providers&offset=${offset}&limit=${limit}`, {
                        timeout: 120000,
                        headers: { 'Cache-Control': 'no-cache' }
                    });

                    const data = resp.data;

                    if (data && data.error) {
                        console.error(`  ❌ Google Script Error: ${data.error}`);
                        break; // Stop THIS state on script logic error
                    }

                    if (Array.isArray(data) && data.length > 0) {
                        allProviders.push(...data);
                        console.log(`  ✅ Success: ${allProviders.length} records collected.`);

                        if (data.length < limit) {
                            console.log(`  🏁 End of data reached for ${stateName}.`);
                            hasMore = false;
                        } else {
                            offset += data.length;
                        }
                        errorStreak = 0; // Reset on success
                        await new Promise(r => setTimeout(r, 1000)); // Short breather
                    } else {
                        // 🚀 Persistent Retry for Empty Array (mid-way)
                        console.warn(`  ⚠️ Received empty array at offset ${offset}. Retrying in 15s...`);
                        await new Promise(r => setTimeout(r, 15000));
                        // Note: We don't increment offset, so it tries the same one again.
                        // We check for final end by checking if we have at least SOME data
                        if (allProviders.length > 0 && errorStreak > 2) {
                             console.log(`  🏁 End assumed after multiple empty responses.`);
                             hasMore = false;
                        }
                        errorStreak++;
                    }
                } catch (e) {
                    errorStreak++;
                    const statusCode = e.response ? e.response.status : "TIMEOUT";
                    console.error(`  ❌ Batch Fail (Error ${statusCode}): ${e.message}`);
                    console.log(`  ⏳ Persistent Retry: Retrying offset ${offset} in 20s...`);
                    await new Promise(r => setTimeout(r, 20000));
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
                } else {
                    console.warn(`  ⚠️ Rejected: All records belonged to other states.`);
                }
            }
        }
        console.log(`\n🚀 FULL SYNC CYCLE COMPLETE!\n`);
    } catch (e) {
        console.error(`❌ FATAL GLOBAL ERROR: ${e.message}`);
        process.exit(1);
    }
}

startRobotSync();
