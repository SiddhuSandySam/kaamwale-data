const { chromium } = require('playwright');
const axios = require('axios');

const HUB_URL = "https://script.google.com/macros/s/AKfycbwusItVLmzBrHG_kTXCno7pjLoQRMlnmN6vps8QvgHf3oxEA6eSuSNg0KmsBxYAcsPKeg/exec";

function writeLog(msg) {
    const timestamp = new Date().toLocaleString();
    console.log(`[TEST] [${timestamp}] ${msg}`);
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

async function checkClosed(page) {
    try {
        return await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes("Permanently closed") || text.includes("कायमचे बंद") || text.includes("Temporarily closed");
        });
    } catch (e) { return false; }
}

async function extractPortfolio(page) {
    writeLog("📸 Attempting to extract portfolio...");
    try {
        const photoBtn = await page.$('button[aria-label*="Photo"], button[aria-label*="फ़ोटो"], .m67q60 button');
        if (photoBtn) {
            writeLog("✅ Photo button found, clicking...");
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
        } else {
            writeLog("⚠️ Photo button NOT found. Trying fallback extraction from main page...");
        }

        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(el => {
                if (el.src?.includes('googleusercontent.com')) {
                    // Strip size parameters to get base image URL
                    links.add(el.src.split('=')[0].split('/s')[0]);
                }
            });
            document.querySelectorAll('div[style*="background-image"]').forEach(el => {
                const bg = el.style.backgroundImage;
                const match = bg.match(/url\(["']?([^"']+)["']?\)/);
                if (match && match[1].includes('googleusercontent.com')) {
                    links.add(match[1].split('=')[0].split('/s')[0]);
                }
            });
            // Append s1000 for high quality
            return Array.from(links).map(b => `${b}=s1000`).slice(0, 20);
        });
    } catch (e) {
        writeLog("❌ Portfolio extraction error: " + e.message);
        return [];
    }
}

async function runTest() {
    const task = {
        id: "shadow_8422983322",
        name: "pandit ji for pooja in ulwe",
        addr: "plot no.9, Shree Vitthal Rakhumai mandir ke samne, सेक्टर 25, Ulwe, Maharashtra 410206",
        state: "Maharashtra"
    };

    writeLog(`🚀 TARGETED TEST START: ${task.name}`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const dbPhone = task.id.replace('shadow_', '');

    try {
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(task.name + ", " + task.addr)}`;
        writeLog(`🌐 Navigating to: ${searchUrl}`);
        await page.goto(searchUrl, { timeout: 60000 });
        await page.waitForTimeout(8000); // Give it more time

        // Check if we got a list or a single result
        const results = await page.$$('a.hfpxzc');
        if (results.length > 0) {
            writeLog(`📋 List view detected (${results.length} items). Clicking first result...`);
            await results[0].click();
            await page.waitForTimeout(5000);
        } else {
            writeLog("👤 Single result or direct profile detected.");
        }

        // 1. Check if closed
        if (await checkClosed(page)) {
            writeLog("🗑️ RESULT: CLOSED");
            await browser.close();
            return;
        }

        // 2. Phone Match
        const mapsPhone = await extractPhone(page);
        const cleanMapsPhone = mapsPhone !== "NOT_FOUND" ? mapsPhone.replace(/[^0-9]/g, '').slice(-10) : "NOT_FOUND";
        const isMatch = (cleanMapsPhone !== "NOT_FOUND") && (dbPhone.includes(cleanMapsPhone) || cleanMapsPhone.includes(dbPhone));

        if (isMatch) {
            writeLog(`✅ PHONE MATCH SUCCESS: Found ${cleanMapsPhone} (Expected ${dbPhone})`);
            let portfolio = await extractPortfolio(page);

            if (portfolio.length > 0) {
                writeLog(`✨ SUCCESS: Found ${portfolio.length} images.`);
                portfolio.slice(0, 5).forEach((url, i) => console.log(`   [${i+1}] ${url}`));

                // Sync attempt to Hub
                const update = {
                    id: task.id,
                    state: task.state,
                    profilePhotoUrl: portfolio[0].split('=')[0] + '=w500-h500-k-no',
                    portfolioUrls: portfolio.join(',')
                };

                writeLog("📡 Syncing to Hub...");
                const resp = await axios.post(HUB_URL, { type: "BATCH_IMAGE_UPDATE", updates: [update] });
                const respDone = await axios.post(HUB_URL, { type: "MARK_REFRESH_DONE", ids: [task.id] });
                writeLog(`📊 Hub Response: ${JSON.stringify(resp.data)}`);
            } else {
                writeLog("⚠️ FAIL: Phone matched but NO images found.");
            }
        } else {
            writeLog(`❌ FAIL: Phone Mismatch. Maps: ${cleanMapsPhone} | DB: ${dbPhone}`);
            // Let's log some text around the phone area to see why it failed
            const pageText = await page.innerText('body');
            if (pageText.includes(dbPhone)) {
                writeLog("💡 Note: DB phone number WAS found somewhere on the page text, but selector missed it.");
            }
        }
    } catch (err) {
        writeLog("❌ ERROR: " + err.message);
    } finally {
        await browser.close();
        writeLog("🏁 TEST COMPLETE.");
    }
}

runTest();
