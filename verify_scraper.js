const { chromium } = require('playwright');

async function verifyOnGitHub() {
    console.log("\n===============================================");
    console.log("🕵️‍♂️ GITHUB ACTIONS: Scraper Verification Test");
    console.log("===============================================\n");

    const browser = await chromium.launch({ headless: true }); // GitHub uses headless
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    const testQuery = "Plumber in Vashi, Navi Mumbai";
    console.log(`🔍 Testing Google Maps Search: ${testQuery}`);

    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(testQuery)}`);
        await page.waitForSelector('a.hfpxzc', { timeout: 30000 });

        const listing = (await page.$$('a.hfpxzc'))[0];
        const nameRaw = await listing.getAttribute('aria-label');

        await listing.click();
        await page.waitForTimeout(5000);

        const businessName = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => "N/A");
        const phoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "No Phone");
        const fullAddress = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "No Address");

        console.log("-----------------------------------------------");
        console.log(`🏗️  BUSINESS: ${businessName}`);
        console.log(`📱 PHONE   : ${phoneStr}`);
        console.log(`📍 ADDRESS : ${fullAddress}`);
        console.log("-----------------------------------------------");

        if (businessName !== "N/A" && phoneStr !== "No Phone") {
            console.log("\n✨ SUCCESS! GitHub can fetch data perfectly.");
        } else {
            console.log("\n⚠️ Partial data. Panel might be slow.");
        }

    } catch (e) {
        console.error(`❌ FATAL ERROR: ${e.message}`);
    } finally {
        await browser.close();
        console.log("\n🏁 VERIFICATION FINISHED.");
    }
}

verifyOnGitHub();
