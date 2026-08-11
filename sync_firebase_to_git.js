/**
 * RAPIDHELP PROGRESS SYNC BOT
 * Fetches latest progress for all workers from Firebase and updates local JSON files.
 */
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'serviceAccountKey.json');
const TOTAL_WORKERS = 15;

// INITIALIZE FIREBASE
let db;
if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE));
    if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
    console.log("🚀 Firebase Initialized for Progress Sync.");
} else {
    console.error("❌ Missing serviceAccountKey.json. Cannot sync.");
    process.exit(1);
}

async function runSync() {
    console.log(`🛠️ Syncing progress for ${TOTAL_WORKERS} workers...`);

    for (let i = 0; i < TOTAL_WORKERS; i++) {
        const docId = `progress_W${i}`;
        const localFile = path.join(__dirname, `progress_W${i}.json`);

        try {
            const doc = await db.collection('metadata').doc(docId).get();
            if (doc.exists) {
                const cloudData = doc.data();

                // Read local if exists to avoid unnecessary writes
                let localData = {};
                if (fs.existsSync(localFile)) {
                    localData = JSON.parse(fs.readFileSync(localFile));
                }

                // Compare to see if update is needed
                if (JSON.stringify(localData) !== JSON.stringify(cloudData)) {
                    fs.writeFileSync(localFile, JSON.stringify(cloudData, null, 2));
                    console.log(`  ✅ W${i}: Updated (City: ${cloudData.cityIndex}, Sub: ${cloudData.subcategoryIndex})`);
                } else {
                    console.log(`  ➖ W${i}: No changes.`);
                }
            } else {
                console.log(`  ⚠️ W${i}: No data found in Firebase.`);
            }
        } catch (e) {
            console.error(`  ❌ W${i}: Sync Failed - ${e.message}`);
        }
    }

    console.log("\n✨ Sync Complete!");
}

runSync().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
