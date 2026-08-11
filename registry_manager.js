const fs = require('fs');
const path = require('path');

// 🚀 Get Worker ID from process arguments to avoid Git conflicts
const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : "MASTER";

const REGISTRY_JSON = path.join(__dirname, 'master_registry.json');
const WORKER_REGISTRY_TXT = path.join(__dirname, `registry_W${WORKER_ID}.txt`);

class RegistryManager {
    constructor() {
        this.registrySet = new Set();
        this.init();
    }

    init() {
        console.log(`RegistryManager | Initializing Worker ${WORKER_ID} Registry...`);

        // 1. Load ALL worker registries to build a shared brain
        const files = fs.readdirSync(__dirname);
        let totalLoaded = 0;
        files.forEach(file => {
            if (file.startsWith('registry_W') && file.endsWith('.txt')) {
                const data = fs.readFileSync(path.join(__dirname, file), 'utf8');
                data.split('\n').forEach(line => {
                    const clean = line.trim();
                    if (clean) {
                        this.registrySet.add(clean);
                        totalLoaded++;
                    }
                });
            }
        });

        // Also load the legacy registry.txt if it exists (for transition)
        const legacyPath = path.join(__dirname, 'registry.txt');
        if (fs.existsSync(legacyPath)) {
            const data = fs.readFileSync(legacyPath, 'utf8');
            data.split('\n').forEach(line => {
                const clean = line.trim();
                if (clean) this.registrySet.add(clean);
            });
        }

        console.log(`RegistryManager | Shared Brain: Loaded ${this.registrySet.size} unique IDs.`);

        // 2. Migrate from JSON if needed
        if (fs.existsSync(REGISTRY_JSON) && this.registrySet.size === 0) {
            try {
                const data = JSON.parse(fs.readFileSync(REGISTRY_JSON));
                const stream = fs.createWriteStream(WORKER_REGISTRY_TXT, { flags: 'a' });
                data.forEach(id => {
                    const clean = String(id).replace('shadow_', '');
                    if (!this.registrySet.has(clean)) {
                        this.registrySet.add(clean);
                        stream.write(clean + '\n');
                    }
                });
                stream.end();
            } catch (e) {}
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
            // 🚀 Write ONLY to this worker's specific file to avoid Git conflicts
            fs.appendFileSync(WORKER_REGISTRY_TXT, cleanPhone + '\n');
        }
    }

    addBatch(phones) {
        let addedCount = 0;
        phones.forEach(p => {
            const clean = String(p).replace('shadow_', '');
            if (!this.registrySet.has(clean)) {
                this.registrySet.add(clean);
                // 🚀 Sync append is much safer for huge batches in GitHub Actions
                fs.appendFileSync(WORKER_REGISTRY_TXT, clean + '\n');
                addedCount++;
            }
        });
        if (addedCount > 0) {
            console.log(`RegistryManager | Batch added ${addedCount} new IDs.`);
        }
    }

    migrateFromJson() {}
}

module.exports = new RegistryManager();
