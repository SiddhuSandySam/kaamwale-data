const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🚀 SETTINGS
const MAHARASHTRA_URL = "https://script.google.com/macros/s/AKfycbzbK2ij2FS5bQjWYgv3gYdyTohXlJsCQcOXrEn9TArWLTEh3kQU50zvTZa87w9tb2vM/exec";
const GRID_DIR = path.join(__dirname, 'maharashtra_grids');

if (!fs.existsSync(GRID_DIR)) fs.mkdirSync(GRID_DIR, { recursive: true });

function getGridId(lat, lon) {
    if (!lat || !lon || lat === 0 || lon === 0) return null;
    const latGrid = Math.floor(lat * 5); 
    const lonGrid = Math.floor(lon * 5);
    return `g_${latGrid}_${lonGrid}`;
}

async function startRobotSync() {
    console.log("🤖 ROBOT: Starting Data Sync from Google Sheets...");
    
    try {
        let allProviders = [];
        let offset = 0;
        const limit = 2000; // 🚀 FIXED: Batch size reduced to 2000 to prevent Google Script Timeout
        let hasMore = true;
        let retryCount = 0;

        while (hasMore) {
            try {
                console.log(`📡 Fetching: Offset ${offset}...`);
                const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, { 
                    timeout: 120000, 
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    headers: { 'Accept-Encoding': 'gzip' } // Speed up transfer
                });
                
                const data = resp.data;

                // Error object check
                if (data && data.error) {
                    throw new Error("Google Script Error: " + data.error);
                }

                if (Array.isArray(data) && data.length > 0) {
                    allProviders.push(...data);
                    console.log(`✅ Received ${data.length} records. Total so far: ${allProviders.length}`);
                    
                    if (data.length < limit) {
                        console.log("🏁 Small batch received. End of data.");
                        hasMore = false;
                    } else {
                        offset += data.length;
                    }
                    retryCount = 0; 
                } else {
                    console.log("🏁 No more data or empty array received.");
                    hasMore = false;
                }
            } catch (fetchErr) {
                retryCount++;
                console.error(`⚠️ Batch Fail at Offset ${offset} (Attempt ${retryCount}): ${fetchErr.message}`);
                if (retryCount >= 3) throw fetchErr; 
                console.log("⏳ Waiting for retry...");
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        console.log(`📊 FINAL SYNC STATS: Total Leads = ${allProviders.length}`);

        if (allProviders.length === 0) {
            console.error("❌ ABORT: No leads found. Stopping to protect CDN.");
            process.exit(1);
        }

        // --- GRID SPLITTING ---
        console.log("🧩 Splitting into Dynamic Grids...");
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

        console.log(`✨ SUCCESS: ${gridKeys.length} grids updated on CDN!`);

    } catch (error) {
        console.error("❌ FATAL ROBOT ERROR:", error.stack || error.message);
        process.exit(1);
    }
}

startRobotSync();
