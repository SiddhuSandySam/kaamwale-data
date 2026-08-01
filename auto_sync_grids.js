const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🚀 SETTINGS
const MAHARASHTRA_URL = "https://script.google.com/macros/s/AKfycbzbK2ij2FS5bQjWYgv3gYdyTohXlJsCQcOXrEn9TArWLTEh3kQU50zvTZa87w9tb2vM/exec";
const GRID_DIR = path.join(__dirname, 'maharashtra_grids');

// Create folder if missing
if (!fs.existsSync(GRID_DIR)) fs.mkdirSync(GRID_DIR, { recursive: true });

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    const latGrid = Math.floor(lat * 5);
    const lonGrid = Math.floor(lon * 5);
    return `g_${latGrid}_${lonGrid}`;
}

async function startRobotSync() {
    console.log("🤖 ROBOT: Starting Ultra-Safe Sync (Batch Size: 1000)");

    try {
        let allProviders = [];
        let offset = 0;
        const limit = 1000; // 🚀 OPTIMIZED: Small batches to keep Google Sheets happy
        let hasMore = true;

        while (hasMore) {
            console.log(`📡 Fetching: Offset ${offset}...`);
            try {
                const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, {
                    timeout: 180000, // 3 MIN TIMEOUT
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });

                const data = resp.data;
                if (Array.isArray(data) && data.length > 0) {
                    allProviders.push(...data);
                    console.log(`✅ Success: ${allProviders.length} records so far.`);

                    if (data.length < limit) {
                        console.log("🏁 Final batch received.");
                        hasMore = false;
                    } else {
                        offset += data.length;
                    }

                    // 🚀 PAUSE: 1 sec delay to avoid rate-limiting
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    console.log("🏁 No more records found.");
                    hasMore = false;
                }
            } catch (err) {
                console.error(`⚠️ Error at Offset ${offset}: ${err.message}. Retrying in 15s...`);
                await new Promise(r => setTimeout(r, 15000));
            }
        }

        console.log(`📊 FINAL TOTAL: ${allProviders.length} leads fetched.`);

        if (allProviders.length > 0) {
            console.log("🧩 Updating Grid Files...");
            const gridData = {};
            allProviders.forEach(p => {
                const gridId = getGridId(p.latitude, p.longitude);
                if (gridId) {
                    if (!gridData[gridId]) gridData[gridId] = [];
                    gridData[gridId].push(p);
                }
            });

            const gridKeys = Object.keys(gridData);
            gridKeys.forEach(gridId => {
                const filePath = path.join(GRID_DIR, `${gridId}.json`);
                fs.writeFileSync(filePath, JSON.stringify(gridData[gridId]));
            });
            console.log(`✨ SUCCESS: ${gridKeys.length} grids updated locally!`);
        }

    } catch (error) {
        console.error("❌ FATAL ROBOT ERROR:", error.message);
        process.exit(1);
    }
}

startRobotSync();
