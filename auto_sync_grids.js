const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🚀 SETTINGS
const MAHARASHTRA_URL = "https://script.google.com/macros/s/AKfycbzbK2ij2FS5bQjWYgv3gYdyTohXlJsCQcOXrEn9TArWLTEh3kQU50zvTZa87w9tb2vM/exec";
const GRID_DIR = path.join(__dirname, 'maharashtra_grids');

if (!fs.existsSync(GRID_DIR)) fs.mkdirSync(GRID_DIR);

function getGridId(lat, lon) {
    if (!lat || !lon) return null;
    const latGrid = Math.floor(lat * 5); 
    const lonGrid = Math.floor(lon * 5);
    return `g_${latGrid}_${lonGrid}`;
}

async function startRobotSync() {
    console.log("🤖 Robot Started: Fetching Maharashtra Sheet...");
    
    try {
        let allProviders = [];
        let offset = 0;
        const limit = 5000;
        let hasMore = true;
        let retryCount = 0;

        while (hasMore) {
            try {
                console.log(`  📡 Fetching batch at offset ${offset}...`);
                const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, { 
                    timeout: 90000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                });
                
                const data = resp.data;
                if (Array.isArray(data) && data.length > 0) {
                    allProviders.push(...data);
                    console.log(`  ✅ Success: Received ${data.length} leads.`);
                    if (data.length < limit) hasMore = false;
                    else offset += limit;
                    retryCount = 0; // Reset retry on success
                } else {
                    console.log("  🏁 End of data reached.");
                    hasMore = false;
                }
            } catch (fetchErr) {
                retryCount++;
                console.error(`  ⚠️ Batch Fail (Attempt ${retryCount}): ${fetchErr.message}`);
                if (retryCount >= 3) throw fetchErr; // Stop after 3 fails
                console.log("  ⏳ Waiting 10s before retry...");
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        console.log(`📊 Total Leads Processed: ${allProviders.length}`);

        if (allProviders.length === 0) {
            console.warn("⚠️ No data received. Skipping grid update.");
            return;
        }

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

        console.log(`✅ Robot Success: ${Object.keys(gridData).length} grid files updated!`);

    } catch (error) {
        console.error("❌ Robot FATAL Error:", error.message);
        process.exit(1);
    }
}

startRobotSync();
