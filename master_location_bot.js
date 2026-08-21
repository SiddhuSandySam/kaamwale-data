/**
 * RAPIDHELP MASTER LOCATION BOT (V2 - CROWDSOURCED VALIDATION)
 * 🚀 PURPOSE: Automatically expand config.json based on scraper discoveries.
 * 🛡️ LOGIC: Validate cities based on provider frequency (Majority Voting).
 * Author: Sandesh Koli (RapidHelp)
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DISCOVERY_FILE = path.join(__dirname, 'discovered_locations.json');
const CONFIDENCE_THRESHOLD = 5; // 🚀 Need at least 5 providers to confirm a city

async function expandConfig() {
    if (!fs.existsSync(DISCOVERY_FILE)) {
        console.log("No new discoveries found.");
        return;
    }

    let discoveries;
    try {
        discoveries = JSON.parse(fs.readFileSync(DISCOVERY_FILE));
    } catch (e) {
        console.error("Invalid discovery file.");
        return;
    }

    let config = JSON.parse(fs.readFileSync(CONFIG_FILE));
    let updated = false;

    const keys = Object.keys(discoveries);
    console.log(`\n===============================================`);
    console.log(`🤖 DISCOVERY BOT | Analyzing ${keys.length} suggested locations.`);
    console.log(`===============================================\n`);

    for (const key of keys) {
        const count = discoveries[key];
        const [stateName, cityName] = key.split('|');

        if (count >= CONFIDENCE_THRESHOLD) {
            console.log(`[+] VALIDATED: ${cityName} (${stateName}) found ${count} times.`);

            const stateObj = config.states.find(s => s.name.toLowerCase() === stateName.toLowerCase());
            if (stateObj) {
                if (!stateObj.cities.some(c => c.toLowerCase() === cityName.toLowerCase())) {
                    stateObj.cities.push(cityName);
                    updated = true;
                    console.log(`[!] APPENDED: ${cityName} added to ${stateName}.`);
                } else {
                    console.log(`[i] EXISTS: ${cityName} already in config.`);
                }
            }
        } else {
            console.log(`[-] PENDING: ${cityName} (${stateName}) count is ${count}/${CONFIDENCE_THRESHOLD}. Keeping for next run.`);
        }
    }

    if (updated) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log("\n✅ config.json updated successfully.");
    }

    // Smart Cleanup: Remove only validated cities, keep pending ones for next session
    const remainingDiscoveries = {};
    for (const key of keys) {
        if (discoveries[key] < CONFIDENCE_THRESHOLD) {
            remainingDiscoveries[key] = discoveries[key];
        }
    }
    fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(remainingDiscoveries, null, 2));

    console.log(`\n🏁 SESSION COMPLETE. Pending Discoveries: ${Object.keys(remainingDiscoveries).length}`);
    console.log(`===============================================\n`);
}

expandConfig().catch(err => console.error("Fatal Error:", err));
