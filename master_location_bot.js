/**
 * RAPIDHELP MASTER LOCATION BOT (V1)
 * 🚀 PURPOSE: Validate and add new cities to config.json automatically.
 * 🛡️ SOURCE: OpenStreetMap (OSM) Nominatim API (Free).
 * Author: Sandesh Koli (RapidHelp)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DISCOVERY_FILE = path.join(__dirname, 'discovered_locations.json');
const CONFIDENCE_THRESHOLD = 3;

async function validateAndExpand() {
    if (!fs.existsSync(DISCOVERY_FILE)) {
        console.log("No new locations to validate.");
        return;
    }

    let discoveries;
    try {
        discoveries = JSON.parse(fs.readFileSync(DISCOVERY_FILE));
    } catch (e) {
        console.error("Invalid discovery file format.");
        return;
    }

    let config = JSON.parse(fs.readFileSync(CONFIG_FILE));
    let updated = false;

    const keys = Object.keys(discoveries);
    console.log(`\n===============================================`);
    console.log(`🤖 LOCATION BOT | Found ${keys.length} potential locations.`);
    console.log(`===============================================\n`);

    for (const key of keys) {
        const count = discoveries[key];
        const [stateName, cityName] = key.split('|');

        if (count < CONFIDENCE_THRESHOLD) {
            console.log(`[-] Skipping ${cityName} (${stateName}): Low confidence (${count}/${CONFIDENCE_THRESHOLD})`);
            continue;
        }

        console.log(`[*] Validating ${cityName}, ${stateName} via OSM...`);
        try {
            const url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(cityName)}&state=${encodeURIComponent(stateName)}&country=India&format=json`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'RapidHelp-Location-Bot/1.0 (bot@rapidhelp.in)' },
                timeout: 15000
            });

            if (response.data && response.data.length > 0) {
                console.log(`[+] SUCCESS: ${cityName} is a valid city.`);

                // Add to Config
                const stateObj = config.states.find(s => s.name.toLowerCase() === stateName.toLowerCase());
                if (stateObj) {
                    if (!stateObj.cities.some(c => c.toLowerCase() === cityName.toLowerCase())) {
                        stateObj.cities.push(cityName);
                        updated = true;
                        console.log(`[+] ADDED: ${cityName} appended to ${stateName} list.`);
                    } else {
                        console.log(`[i] ALREADY EXISTS: ${cityName} is already in config.`);
                    }
                }
            } else {
                console.warn(`[!] REJECTED: ${cityName} not found in official maps.`);
            }

            // Respect OSM Rate Limit (1 request per second)
            await new Promise(r => setTimeout(r, 1500));

        } catch (e) {
            console.error(`[X] API Error for ${cityName}: ${e.message}`);
        }
    }

    if (updated) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log("\n✅ config.json updated with new validated cities.");
    }

    // Cleanup: Reset discoveries for next run
    fs.writeFileSync(DISCOVERY_FILE, JSON.stringify({}, null, 2));
    console.log("🧹 Discovery file reset for new cycle.");
    console.log(`\n===============================================\n`);
}

validateAndExpand().catch(err => console.error("Fatal Error:", err));
