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

        while (hasMore) {
            console.log(`  📡 Fetching batch at offset ${offset}...`);
            const resp = await axios.get(`${MAHARASHTRA_URL}?type=providers&offset=${offset}&limit=${limit}`, { timeout: 60000 });
            const data = resp.data;
            if (Array.isArray(data) && data.length > 0) {
                allProviders.push(...data);
                if (data.length < limit) hasMore = false;
                else offset += limit;
            } else { hasMore = false; }
        }

        console.log(`📊 Total Leads: ${allProviders.length}`);

        // Clean current grids
        const gridData = {};
        allProviders.forEach(p => {
            const gridId = getGridId(p.latitude, p.longitude);
            if (gridId) {
                if (!gridData[gridId]) gridData[gridId] = [];
                gridData[gridId].push(p);
            }
        });

        // Save updated grids
        Object.keys(gridData).forEach(gridId => {
            fs.writeFileSync(path.join(GRID_DIR, `${gridId}.json`), JSON.stringify(gridData[gridId]));
        });

        console.log(`✅ Robot Success: ${Object.keys(gridData).length} grids updated!`);

    } catch (error) {
        console.error("❌ Robot Fail:", error.message);
        process.exit(1);
    }
}

startRobotSync();
