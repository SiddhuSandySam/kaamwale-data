/**
 * RAPIDHELP GRID CLEANER & DEDUPLICATOR (V1)
 * 🛡️ FIXES: Subcategory count mismatch and double counting.
 */

const fs = require('fs');
const path = require('path');

const GRID_DIR = path.join(__dirname, 'maharashtra_grids');
const HUB_DATA_FILE = path.join(__dirname, 'hub_data.json');

// 1. Load Valid Subcategories
const hubData = JSON.parse(fs.readFileSync(HUB_DATA_FILE, 'utf8'));
const validSubcats = new Set();
hubData.categories.forEach(cat => {
    cat.sub.forEach(sub => validSubcats.add(sub));
});

console.log(`✅ Loaded ${validSubcats.size} valid subcategories.`);

function cleanGrids() {
    if (!fs.existsSync(GRID_DIR)) {
        console.error("❌ Grid directory not found.");
        return;
    }

    const files = fs.readdirSync(GRID_DIR).filter(f => f.endsWith('.json'));
    console.log(`📡 Processing ${files.length} grid files...`);

    let totalRemoved = 0;
    let totalDeduplicated = 0;

    files.forEach(file => {
        const filePath = path.join(GRID_DIR, file);
        let providers = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        const initialCount = providers.length;
        const phoneMap = new Map();

        // --- STEP 1: DEDUPLICATE BY PHONE AND FILTER VALID SUBCATS ---
        const cleaned = providers.filter(p => {
            // Check if subcategory is valid
            if (!validSubcats.has(p.subcategory)) {
                totalRemoved++;
                return false;
            }

            // Keyword protection (Simple fix for Eye Clinic in Pet Groomer)
            const name = (p.businessName || "").toLowerCase();
            const sub = (p.subcategory || "").toLowerCase();
            if (sub.includes("pet") && (name.includes("hospital") || name.includes("clinic") || name.includes("eye"))) {
                totalRemoved++;
                return false;
            }

            // Deduplicate by Phone Number
            const phone = p.callNumber || p.whatsappNumber;
            if (phone && phone.length >= 10) {
                const cleanPhone = phone.slice(-10);
                if (phoneMap.has(cleanPhone)) {
                    totalDeduplicated++;
                    return false; // Already exists
                }
                phoneMap.set(cleanPhone, true);
            }

            return true;
        });

        if (cleaned.length !== initialCount) {
            fs.writeFileSync(filePath, JSON.stringify(cleaned));
            // console.log(`  ✨ Cleaned ${file}: ${initialCount} -> ${cleaned.length}`);
        }
    });

    console.log(`\n===============================================`);
    console.log(`✅ MISSION SUCCESSFUL: GRIDS CLEANED`);
    console.log(`❌ Invalid Records Removed: ${totalRemoved}`);
    console.log(`👯 Duplicates Removed: ${totalDeduplicated}`);
    console.log(`===============================================\n`);
}

cleanGrids();
