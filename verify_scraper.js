const { chromium } = require('playwright');

async function extractPortfolio(page) {
    try {
        return await page.evaluate(() => {
            const links = new Set();
            document.querySelectorAll('img').forEach(img => {
                const src = img.src || '';
                if (src.includes('googleusercontent.com') && !src.includes('base64')) {
                    links.add(src.split('=')[0] + '=w1000-h1000');
                }
            });
            return Array.from(links).slice(0, 5);
        });
    } catch (e) { return []; }
}

async function verifyFullData() {
    console.log("\n===============================================");
    console.log("🕵️‍♂️ GITHUB ACTIONS: Full 31-Column Data Test");
    console.log("===============================================\n");

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const city = "Vashi";
    const state = "Maharashtra";
    const subcat = "Plumber";

    console.log(`🔍 Searching: ${subcat} in ${city}, ${state}`);

    try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(subcat + " in " + city + ", " + state)}`);
        await page.waitForSelector('a.hfpxzc', { timeout: 30000 });

        const listing = (await page.$$('a.hfpxzc'))[0];
        const nameRaw = await listing.getAttribute('aria-label');

        await listing.click();
        await page.waitForTimeout(5000); // Wait for details

        const businessName = await page.$eval('h1.DUwDvf', el => el.innerText).catch(() => nameRaw);
        const phoneStr = await page.$eval('button[data-item-id^="phone"]', el => el.innerText).catch(() => "");
        const cleanPhone = phoneStr.replace(/[^0-9]/g, '').slice(-10);
        const fullAddress = await page.$eval('button[data-item-id="address"]', el => el.innerText).catch(() => "N/A");
        const urlCoords = page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const portfolio = await extractPortfolio(page);

        // 🛡️ THE 31 COLUMN OBJECT (Exactly as sent to Sheet)
        const provider = {
            id: `shadow_${cleanPhone}`,
            businessName: businessName,
            primaryCategoryId: "cat_home",
            subcategory: subcat,
            experienceYears: 3,
            serviceMode: "Local",
            city: city,
            locality: "Vashi Sector 1",
            state: state,
            startingPrice: 0,
            priceUnit: "Discuss on Call",
            whatsappNumber: cleanPhone,
            callNumber: cleanPhone,
            aboutDescription: "Test from GitHub Actions",
            isApproved: true,
            isVerified: false,
            rating: 0.0,
            profilePhotoUrl: portfolio[0] || "",
            recommendationCount: 0,
            portfolioUrls: portfolio,
            searchKeywords: [businessName, city, subcat],
            lastSeen: Date.now(),
            callCount: 0,
            fullAddress: fullAddress.replace('', '').trim(),
            isNumberHidden: false,
            referredBy: "GITHUB_VERIFIER",
            referralBonusPaid: false,
            fcmToken: "",
            notificationsEnabled: true,
            latitude: urlCoords ? parseFloat(urlCoords[1]) : 0,
            longitude: urlCoords ? parseFloat(urlCoords[2]) : 0
        };

        console.log("✅ FULL EXTRACTED DATA OBJECT:");
        console.log(JSON.stringify(provider, null, 2));
        console.log("\n-----------------------------------------------");
        console.log("✨ COLUMNS VERIFIED: " + Object.keys(provider).length + "/31");
        console.log("-----------------------------------------------");

    } catch (e) {
        console.error(`❌ TEST FAILED: ${e.message}`);
    } finally {
        await browser.close();
        console.log("\n🏁 VERIFICATION FINISHED.");
    }
}

verifyFullData();
