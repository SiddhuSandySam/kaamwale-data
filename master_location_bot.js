/**
 * RAPIDHELP MASTER LOCATION BOT (V5 - STRICT FILTERING)
 * 🚀 PURPOSE: Merge and validate city discoveries from all 15 workers.
 * 🛡️ RULES: Min 3 chars, No numbers, No Plus-Codes, confidence >= 10.
 * Author: Sandesh Koli (RapidHelp)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIDENCE_THRESHOLD = 10;

async function syncToSheet() {
    console.log(`\n[${new Date().toLocaleString()}] 🚀 DISCOVERY BOT V5 STARTED...`);

    const allDiscoveries = {};
    const workerFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('discovered_W') && f.endsWith('.json'));

    if (workerFiles.length === 0) {
        console.log("ℹ️ No worker discovery files found.");
        return;
    }

    // 🚀 STEP 1: MERGE ALL WORKER FILES
    console.log(`📂 Merging ${workerFiles.length} worker files...`);
    for (const file of workerFiles) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(__dirname, file)));
            for (const key in data) {
                allDiscoveries[key] = (allDiscoveries[key] || 0) + data[key];
            }
            // Delete worker file after merging to keep Git clean
            fs.unlinkSync(path.join(__dirname, file));
        } catch (e) { console.error(`❌ Error reading ${file}: ${e.message}`); }
    }

    const keys = Object.keys(allDiscoveries);
    const stats = { added: 0, existed: 0, pending: 0, rejected: 0, errors: 0 };
    const remainingDiscoveries = {};

    console.log(`📊 Processing ${keys.length} merged suggestions...`);
    console.log(`---------------------------------------------------------------`);

    for (const key of keys) {
        const count = allDiscoveries[key];
        const [stateName, cityName] = key.split('|');

        // 🛡️ STRICT FILTERS:
        const hasNumbers = /\d/.test(cityName);
        const isTooShort = cityName.length < 3;
        const hasSpecialChars = /[^a-zA-Z\s]/.test(cityName);

        // 🚀 NEW: Landmark/POI Filter
        const junkPrefixes = ['next to', 'opp', 'near', 'inside', 'beside', 'behind', 'backside', 'front of'];
        const isLandmark = junkPrefixes.some(prefix => cityName.toLowerCase().startsWith(prefix));

        if (hasNumbers || isTooShort || hasSpecialChars || isLandmark) {
            console.log(`[X] REJECTED: ${cityName} (${isLandmark ? 'Landmark' : 'Failed Rules'})`);
            stats.rejected++;
            continue;
        }

        if (count >= CONFIDENCE_THRESHOLD) {
            process.stdout.write(`[*] [${stateName}] ${cityName} (${count}) -> Validating... `);

            try {
                const response = await axios.post(HUB_URL, {
                    type: "ADD_NEW_CITY",
                    state: stateName,
                    city: cityName
                });

                const resMsg = String(response.data);
                if (resMsg.includes("Success")) {
                    console.log("✅ ADDED");
                    stats.added++;
                } else if (resMsg.includes("Exists")) {
                    console.log("⏭️ EXISTS");
                    stats.existed++;
                } else {
                    console.log(`⚠️ ERROR: ${resMsg}`);
                    stats.errors++;
                    remainingDiscoveries[key] = count;
                }
            } catch (e) {
                console.log(`❌ FAIL: ${e.message}`);
                stats.errors++;
                remainingDiscoveries[key] = count;
            }
        } else {
            stats.pending++;
            remainingDiscoveries[key] = count;
        }
    }

    // 🚀 SAVE PENDING: Only save cities that are still building confidence
    if (Object.keys(remainingDiscoveries).length > 0) {
        // Save to a unified file for next bot run
        fs.writeFileSync(path.join(__dirname, 'discovered_W_MASTER.json'), JSON.stringify(remainingDiscoveries, null, 2));
    }

    console.log(`---------------------------------------------------------------`);
    console.log(`🏁 FINAL REPORT:`);
    console.log(`✅ Newly Added:    ${stats.added}`);
    console.log(`⏭️  Already Existed: ${stats.existed}`);
    console.log(`⏳ Still Pending:  ${stats.pending}`);
    console.log(`🛡️  Rules Rejected: ${stats.rejected}`);
    console.log(`❌ Failed/Errors:   ${stats.errors}`);
    console.log(`---------------------------------------------------------------`);
}

syncToSheet().catch(err => console.error("Fatal Error:", err));
