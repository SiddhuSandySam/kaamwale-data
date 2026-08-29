const { chromium } = require('playwright');
const axios = require('axios');

const args = process.argv.slice(2);
const WORKER_ID = args[0] !== undefined ? parseInt(args[0]) : 0;
const TOTAL_WORKERS = args[1] !== undefined ? parseInt(args[1]) : 1;

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = { states: [] };
if (fs.existsSync(CONFIG_FILE)) {
    try { config = JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch (e) {}
}

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    const logMsg = `[W${WORKER_ID}] [${timestamp}] ${msg}\n`;
    console.log(`[W${WORKER_ID}] ${msg}`);
    const LOG_FILE = path.join(__dirname, `refresh_logs_W${WORKER_ID}.txt`);
    fs.appendFileSync(LOG_FILE, logMsg);
}

async function extractPhone(page) {
    const selectors = ['button[data-item-id^="phone"]', 'button[aria-label*="Phone"]', '.CsEnBe[aria-label*="Phone"]', 'a[href^="tel:"]'];
    for (let sel of selectors) {
        try {
            const text = await page.$eval(sel, el => el.innerText || el.getAttribute('aria-label') || el.getAttribute('href') || "");
            const clean = text.replace(/[^0-9]/g, '');
            if (clean.length >= 8) return clean;
        } catch (e) {}
    }
    return "NOT_FOUND";
}

async function extractKeywords(page) {
    try {
        return await page.evaluate(() => {
            const category = document.querySelector('button[jsaction="pane.rating.category"]')?.innerText || "";
            const tags = Array.from(document.querySelectorAll('.YR19ub')).map(el => el.innerText).join(",");
            return (category + "," + tags).split(',').map(s => s.trim()).filter(s => s.length > 2).join(",");
        });
    } catch (e) { return ""; }
}

async function checkClosed(page) {
    try {
        return await page.evaluate(() => {
            const infoPanel = document.querySelector('div[role="main"], div[role="dialog"]') || document.body;
            const text = infoPanel.innerText;
            // 🚨 CRITICAL FIX: Only match PERMANENT closure. Regular "Closed" is ignored.
            return text.includes("Permanently closed") || text.includes("कायमचे बंद");
        });
    } catch (e) { return false; }
}

async function extractPortfolio(page) {
    try {
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
            await photoBtn.click({ force: true });
            await page.waitForTimeout(6000);
            await page.evaluate(async () => {
                const findScrollable = () => {
                    const elements = document.querySelectorAll('div[role="main"], div[role="grid"], div[aria-label*="Photos"], .m67q60');
                    for (let el of elements) { if (el.scrollHeight > el.clientHeight) return el; }
                    return document.querySelector('div[tabindex="0"]');
                };
                const scrollArea = findScrollable();
                if (scrollArea) {
                    for(let i=0; i<8; i++) {
                        scrollArea.scrollBy(0, 2000);
                        await new Promise(r => setTimeout(r, 700));
                    }
                }
            });
            await page.waitForTimeout(3000);
        }
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src?.includes('googleusercontent.com') && !el.src.includes('/a/')) {
                    // Deduplicate by stripping size parameters
                    links.add(el.src.split('=')[0].split('/s')[0]);
                }
            });
            document.querySelectorAll('div[style*="background-image"]').forEach(el => {
                const bg = el.style.backgroundImage;
                const match = bg.match(/url\(["']?([^"']+)["']?\)/);
                if (match && match[1].includes('googleusercontent.com') && !match[1].includes('/a/')) {
                    links.add(match[1].split('=')[0].split('/s')[0]);
                }
            });
            // Append s1000 for high quality
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 30);
        });
    } catch (e) { return []; }
}

async function runWorker() {
    writeLog(`Worker ${WORKER_ID} Started.`);
    try {
        const allTasks = (await axios.post(HUB_URL, { type: "GET_REFRESH_QUEUE" })).data;
        if (!Array.isArray(allTasks) || allTasks.length === 0) return writeLog("Queue Empty.");

        const myTasks = allTasks.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
        const page = await context.newPage();

        let pendingUpdates = [];
        let completedIds = [];
        let discoveryLeads = [];

        for (const task of myTasks) {
            const dbPhone = String(task.id).replace('shadow_', '');
            writeLog(`\n🔍 START SCAN: ${task.name} | Target Phone: ${dbPhone} | Location: ${task.addr}`);

            try {
                await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`, { timeout: 60000 });
                await page.waitForTimeout(5000);

                // 🚀 HYBRID DISCOVERY: Scroll 3 times to see more results
                for (let i = 0; i < 3; i++) {
                    await page.mouse.wheel(0, 2000);
                    await page.waitForTimeout(1000);
                }

                const results = await page.$$('a.hfpxzc');
                writeLog(`📊 Search returned ${results.length} results.`);

                let targetFoundInSearch = false;

                // Process top 10 results for Discovery + Target
                for (let i = 0; i < Math.min(results.length, 10); i++) {
                    try {
                        const listing = results[i];
                        const nameRaw = await listing.getAttribute('aria-label').catch(() => "Unknown");

                        await listing.scrollIntoViewIfNeeded();
                        await listing.click({ force: true });
                        await page.waitForTimeout(3000);

                        // Match logic
                        const mapsPhone = await extractPhone(page);
                        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
                        const isTarget = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

                        if (isTarget) {
                            targetFoundInSearch = true;
                            writeLog(`✅ TARGET MATCH: ${nameRaw} (${cleanMapsPhone})`);

                            if (await checkClosed(page)) {
                                writeLog(`🗑️ SKIP [CLOSED]: Target is permanently closed.`);
                                await axios.post(HUB_URL, { type: "DELETE_ENTRIES", ids: [task.id], state: task.state });
                                break; // Move to next task
                            }

                            const keywords = await extractKeywords(page);
                            let portfolio = await extractPortfolio(page);

                            if (portfolio.length > 0) {
                                writeLog(`📸 REFRESHING: ${portfolio.length} images.`);
                                pendingUpdates.push({
                                    id: task.id,
                                    state: task.state,
                                    profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                                    portfolioUrls: portfolio.join(','),
                                    searchKeywords: keywords
                                });
                                completedIds.push(task.id);
                            }
                        } else if (cleanMapsPhone !== "NOT_FOUND" && cleanMapsPhone.length === 10) {
                            // 💡 DISCOVERY: Found someone new!
                            writeLog(`💡 DISCOVERY: Found ${nameRaw} (${cleanMapsPhone})`);

                            // Address discovery logic
                            const addr = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "");
                            if (addr) processAddressDiscovery(addr, task.state);

                            // Basic Lead Info for Hub
                            discoveryLeads.push({
                                id: `shadow_${cleanMapsPhone}`,
                                businessName: nameRaw,
                                whatsappNumber: cleanMapsPhone,
                                callNumber: cleanMapsPhone,
                                state: task.state,
                                fullAddress: addr.replace('\n', '').trim(),
                                timestamp: Date.now(),
                                referredBy: "IMAGE_REFRESHER_DISCOVERY"
                            });
                        }

                        // Flush Batches
                        if (pendingUpdates.length >= 5) {
                            await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: pendingUpdates });
                            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: completedIds });
                            writeLog(`🚀 SYNC: Updated ${pendingUpdates.length} target profiles.`);
                            pendingUpdates = []; completedIds = [];
                        }

                        if (discoveryLeads.length >= 5) {
                            await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: discoveryLeads });
                            writeLog(`✨ DISCOVERY: Pushed ${discoveryLeads.length} new leads to Hub.`);
                            discoveryLeads = [];
                        }

                        if (targetFoundInSearch && i > 3) break; // If we found target and did some discovery, move on

                    } catch (e) { writeLog(`⚠️ Error in listing ${i}: ${e.message}`); }
                }

                // If target was never matched in top 10
                if (!targetFoundInSearch) {
                    writeLog(`❌ FAIL: Target phone ${dbPhone} not found in top 10 results.`);
                    await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: [task.id] });
                }

            } catch (err) { writeLog(`❌ ERROR: Failed task ${task.name}: ${err.message}`); }
        }

        // Final Flush
        if (pendingUpdates.length > 0) {
            await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: pendingUpdates });
            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: completedIds });
        }
        if (discoveryLeads.length > 0) {
            await axios.post(HUB_URL, { type: "BATCH_PROVIDER_SYNC", providers: discoveryLeads });
        }
        await browser.close();
    } catch (e) { writeLog(`Fatal: ${e.message}`); }
}

function processAddressDiscovery(fullAddress, state) {
    try {
        const parts = fullAddress.split(',').map(p => p.trim());
        const JUNK = ['building', 'shop', 'floor', 'plot', 'near', 'road', 'sector'];

        for (let i = 0; i < Math.min(parts.length, 5); i++) {
            const raw = parts[i];
            const lower = raw.toLowerCase();
            if (raw.includes('+') || JUNK.some(k => lower.includes(k)) || raw.length < 3) continue;

            const clean = raw.replace(/[0-9]/g, '').trim();
            if (clean.length < 3) continue;

            const isExisting = config.states.some(s =>
                s.name.toLowerCase().includes(state.toLowerCase()) &&
                s.cities.some(c => c.toLowerCase() === clean.toLowerCase())
            );

            if (!isExisting) {
                const discoveryFile = path.join(__dirname, `discovered_W${WORKER_ID}.json`);
                let discoveries = {};
                if (fs.existsSync(discoveryFile)) {
                    try { discoveries = JSON.parse(fs.readFileSync(discoveryFile)); } catch (e) {}
                }
                const key = `${state}|${clean}`;
                discoveries[key] = (discoveries[key] || 0) + 1;
                fs.writeFileSync(discoveryFile, JSON.stringify(discoveries, null, 2));
            }
        }
    } catch (e) {}
}
        if (pendingUpdates.length > 0) {
            await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: pendingUpdates });
            await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: completedIds });
        }
        await browser.close();
    } catch (e) { writeLog(`Fatal: ${e.message}`); }
}

runWorker();
