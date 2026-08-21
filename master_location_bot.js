/**
 * RAPIDHELP MASTER LOCATION BOT (V4 - DETAILED LOGGING)
 * 🚀 PURPOSE: Automatically expand Google Sheet "Locations" with advanced reporting.
 * 🛡️ LOGIC: Majority voting (Count >= 5) and direct Google Sheet sync.
 * Author: Sandesh Koli (RapidHelp)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const DISCOVERY_FILE = path.join(__dirname, 'discovered_locations.json');
const CONFIDENCE_THRESHOLD = 5;

async function syncToSheet() {
    console.log(`\n[${new Date().toLocaleString()}] 🚀 DISCOVERY BOT V4 STARTED...`);

    if (!fs.existsSync(DISCOVERY_FILE)) {
        console.log("ℹ️ No discovery file found. Nothing to do.");
        return;
    }

    let discoveries;
    try {
        discoveries = JSON.parse(fs.readFileSync(DISCOVERY_FILE));
    } catch (e) {
        console.error("❌ Error reading discovery file.");
        return;
    }

    const keys = Object.keys(discoveries);
    if (keys.length === 0) {
        console.log("ℹ️ Discovery file is empty.");
        return;
    }

    console.log(`📊 Found ${keys.length} unique location suggestions. Analyzing confidence...`);
    console.log(`---------------------------------------------------------------`);

    const stats = { added: 0, existed: 0, pending: 0, errors: 0 };
    const remainingDiscoveries = {};

    for (const key of keys) {
        const count = discoveries[key];
        const [stateName, cityName] = key.split('|');

        if (count >= CONFIDENCE_THRESHOLD) {
            process.stdout.write(`[*] [${stateName}] ${cityName} (${count}/${CONFIDENCE_THRESHOLD}) -> Validating... `);

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
                    console.log("⏭️ ALREADY IN SHEET");
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
            // console.log(`[-] [${stateName}] ${cityName} (${count}/${CONFIDENCE_THRESHOLD}) -> PENDING`);
            stats.pending++;
            remainingDiscoveries[key] = count;
        }
    }

    // Save state
    fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(remainingDiscoveries, null, 2));

    console.log(`---------------------------------------------------------------`);
    console.log(`🏁 BATCH COMPLETE REPORT:`);
    console.log(`✅ Newly Added:    ${stats.added}`);
    console.log(`⏭️  Already Existed: ${stats.existed}`);
    console.log(`⏳ Still Pending:  ${stats.pending}`);
    console.log(`❌ Failed/Errors:   ${stats.errors}`);
    console.log(`---------------------------------------------------------------`);
    console.log(`[${new Date().toLocaleString()}] 🚀 BOT FINISHED.\n`);
}

syncToSheet().catch(err => console.error("Fatal Error:", err));
