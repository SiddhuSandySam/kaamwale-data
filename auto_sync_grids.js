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
    console.log("🤖 ROBOT: Starting Ultra-Safe Sync...");
    
    try {
        let allProviders = [];
        let offset = 0;
        const limit = 1000; // 🚀 ULTRA SAFE: Small batches to avoid Google Timeouts
        let hasMore = true;

        while (hasMore) {
            console.log(`📡 Fetching: Offset ${offset}...`);
            try {
                const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, { 
                    timeout: 300000, // 🚀 5 MIN TIMEOUT
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
                
                const data = resp.data;
                if (Array.isArray(data) && data.length > 0) {
                    allProviders.push(...data);
                    console.log(`✅ Progress: ${allProviders.length} records collected.`);
                    
                    if (data.length < limit) {
                        hasMore = false;
                    } else {
                        offset += data.length;
                    }
                    
                    // 🚀 BREATHE: Give Google Script a 1-second break
                    await new Promise(r => setTimeout(r, 1000));

                } else {
                    hasMore = false;
                }
            } catch (err) {
                console.error(`⚠️ Batch Fail at ${offset}: ${err.message}. Retrying in 15s...`);
                await new Promise(r => setTimeout(r, 15000));
                // Will retry the same offset in next loop
            }
        }

        console.log(`📊 TOTAL SYNCED: ${allProviders.length} leads.`);

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

            Object.keys(gridData).forEach(gridId => {
                fs.writeFileSync(path.join(GRID_DIR, `${gridId}.json`), JSON.stringify(gridData[gridId]));
            });
            console.log("✨ ALL GRIDS UPDATED SUCCESSFULLY!");
        }

    } catch (error) {
        console.error("❌ FATAL:", error.message);
        process.exit(1);
    }
}

startRobotSync();
