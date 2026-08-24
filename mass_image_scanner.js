const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const SCAN_RESULTS_DIR = path.join(__dirname, 'refresh_queues');

if (!fs.existsSync(SCAN_RESULTS_DIR)) fs.mkdirSync(SCAN_RESULTS_DIR);

async function checkUrl(url) {
    if (!url || !url.includes('googleusercontent.com')) return true; // Valid enough or not ours
    try {
        const resp = await axios.head(url, { timeout: 5000 });
        return resp.status === 200;
    } catch (e) {
        if (e.response && e.response.status === 403) return false; // Broken
        return true; // Other errors, skip for now
    }
}

async function scanState(stateName, stateUrl) {
    console.log(`\n🔍 SCANNING STATE: ${stateName}`);
    let offset = 0;
    let limit = 500;
    let brokenProviders = [];

    while (true) {
        try {
            console.log(`Fetching batch: ${offset} to ${offset + limit}...`);
            const resp = await axios.get(`${stateUrl}?type=providers&offset=${offset}&limit=${limit}`);
            const providers = resp.data;

            if (!Array.isArray(providers) || providers.length === 0) break;

            for (let p of providers) {
                const isPhotoOk = await checkUrl(p.profilePhotoUrl);
                if (!isPhotoOk) {
                    brokenProviders.push({ id: p.id, name: p.businessName, addr: p.fullAddress });
                    process.stdout.write('X'); // Broken mark
                } else {
                    process.stdout.write('.'); // OK mark
                }
            }

            console.log(`\nFound ${brokenProviders.length} broken links so far in ${stateName}.`);
            offset += limit;

            // Auto-save every batch to prevent data loss
            fs.writeFileSync(path.join(SCAN_RESULTS_DIR, `${stateName}_queue.json`), JSON.stringify(brokenProviders, null, 2));

        } catch (e) {
            console.log(`Error in batch ${offset}: ${e.message}`);
            break;
        }
    }
}

async function main() {
    try {
        console.log("Fetching Routing Table...");
        const hubResp = await axios.get(`${HUB_URL}?type=app_data&nocache=true`);
        const stateUrls = hubResp.data.stateUrls;

        for (let state of Object.keys(stateUrls)) {
            await scanState(state, stateUrls[state]);
        }
        console.log("\n✅ ALL STATES SCANNED. Queues ready in 'refresh_queues' folder.");
    } catch (e) { console.error(e.message); }
}

main();
