const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REGISTRY_TXT = path.join(__dirname, 'registry.txt');
const REGISTRY_JSON = path.join(__dirname, 'master_registry.json');

class RegistryManager {
    constructor() {
        this.registrySet = new Set();
        this.init();
    }

    init() {
        console.log("RegistryManager | Initializing Hyper-Speed Registry...");

        // 1. Load existing IDs from Text File (Line by Line) - DO THIS FIRST
        if (fs.existsSync(REGISTRY_TXT)) {
            const data = fs.readFileSync(REGISTRY_TXT, 'utf8');
            const lines = data.split('\n');
            lines.forEach(line => {
                const clean = line.trim();
                if (clean) this.registrySet.add(clean);
            });
            console.log(`RegistryManager | Loaded ${this.registrySet.size} IDs into memory.`);
        }

        // 2. Migrate from JSON if exists AND Text file is empty/not exist
        if (fs.existsSync(REGISTRY_JSON) && this.registrySet.size === 0) {
            try {
                const data = JSON.parse(fs.readFileSync(REGISTRY_JSON));
                console.log(`RegistryManager | Migrating ${data.length} IDs from JSON to Text...`);

                // Use a Set to ensure unique migration even if JSON has dupes
                const tempSet = new Set();
                const stream = fs.createWriteStream(REGISTRY_TXT, { flags: 'a' });

                data.forEach(id => {
                    const clean = String(id).replace('shadow_', '');
                    if (!this.registrySet.has(clean) && !tempSet.has(clean)) {
                        this.registrySet.add(clean);
                        tempSet.add(clean);
                        stream.write(clean + '\n');
                    }
                });
                stream.end();
                console.log(`RegistryManager | ✅ Migration successful. Added ${tempSet.size} IDs.`);
            } catch (e) {
                console.error("RegistryManager | Migration error:", e.message);
            }
        }
    }

    has(phone) {
        const cleanPhone = String(phone).replace('shadow_', '');
        return this.registrySet.has(cleanPhone);
    }

    add(phone) {
        const cleanPhone = String(phone).replace('shadow_', '');
        if (!this.registrySet.has(cleanPhone)) {
            this.registrySet.add(cleanPhone);
            // Append only: Very fast, doesn't rewrite whole file
            fs.appendFileSync(REGISTRY_TXT, cleanPhone + '\n');
        }
    }

    addBatch(phones) {
        let addedCount = 0;
        const stream = fs.createWriteStream(REGISTRY_TXT, { flags: 'a' });
        phones.forEach(p => {
            const clean = String(p).replace('shadow_', '');
            if (!this.registrySet.has(clean)) {
                this.registrySet.add(clean);
                stream.write(clean + '\n');
                addedCount++;
            }
        });
        stream.end();
        if (addedCount > 0) {
            console.log(`RegistryManager | Batch added ${addedCount} new IDs.`);
        }
    }

    // Keep migrateFromJson for compatibility with multi_worker.js call
    migrateFromJson() {
        // Migration logic is already in init()
    }
}

module.exports = new RegistryManager();
