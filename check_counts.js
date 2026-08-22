/**
 * RAPIDHELP DATA COUNTER 📊
 * 🚀 PURPOSE: Calculate total provider counts across all state grid folders.
 */

const fs = require('fs');
const path = require('path');

const root = __dirname;
let grandTotal = 0;
const results = [];

console.log("\n===============================================");
console.log("📊 RAPIDHELP GLOBAL DATA REPORT");
console.log("===============================================\n");

const files = fs.readdirSync(root);

files.forEach(dir => {
    if (dir.endsWith('_grids')) {
        let stateCount = 0;
        const dirPath = path.join(root, dir);

        try {
            const gridFiles = fs.readdirSync(dirPath);
            gridFiles.forEach(file => {
                if (file.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(dirPath, file));
                        const data = JSON.parse(content);
                        if (Array.isArray(data)) {
                            stateCount += data.length;
                        }
                    } catch (e) {
                        // Skip corrupt files
                    }
                }
            });

            const stateName = dir.replace('_grids', '').toUpperCase().replace(/_/g, ' ');
            results.push({ state: stateName, count: stateCount });
            grandTotal += stateCount;
        } catch (err) {
            // Skip non-directories
        }
    }
});

// Sort by count descending
results.sort((a, b) => b.count - a.count);

results.forEach(res => {
    console.log(`📍 ${res.state.padEnd(20)} : ${res.count.toLocaleString().padStart(10)} providers`);
});

console.log("\n-----------------------------------------------");
console.log(`🔥 GRAND TOTAL         : ${grandTotal.toLocaleString().padStart(10)} providers`);
console.log("===============================================\n");
