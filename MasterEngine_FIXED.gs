/**
 * RAPIDHELP MASTER ENGINE (V70 - ULTIMATE BATCH TURBO)
 * 🚀 PERFORMANCE: TextFinder + Batch I/O (100x faster city search).
 * 🛡️ STABILITY: Reliable 'getLastRow' with local caching.
 * 🛡️ DEDUPE: Column A based ID tracking for 100% data integrity.
 * 🛡️ CACHE: Spreadsheet-ID based isolation to prevent cross-state mixing.
 * Author: Sandesh Koli (RapidHelp)
 */

var CACHE_TTL = 900; // 15 Minutes
var _lrCache = { val: 0, time: 0 };

// --- 1. UTILITIES ---

function getLastRowCached(sheet) {
  if (!sheet) return 0;
  var now = Date.now();
  if (now - _lrCache.time < 5000 && _lrCache.val > 0) return _lrCache.val;
  try {
    var lr = sheet.getLastRow();
    _lrCache = { val: lr, time: now };
    return lr;
  } catch (e) {
    console.error("Error getting last row: " + e.message);
    return 0;
  }
}

// --- 2. MAIN GET HANDLER ---

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return ContentService.createTextOutput("Error: SS not found").setMimeType(ContentService.MimeType.JSON);

  var params = e.parameter || {};
  var type = params.type;
  var latParam = parseFloat(params.lat) || 0;
  var lonParam = parseFloat(params.lon) || 0;
  var cityParam = params.city;
  var sinceParam = parseInt(params.since || 0);
  var offset = parseInt(params.offset || 0);
  var limit = parseInt(params.limit || 200); // 🚀 Small batch size for faster UI response
  var nocache = (params.nocache === "true" || params.nocache === true);

  // 🚀 MASTER CACHE KEY: Isolated by Spreadsheet ID
  var ssId = ss.getId().substring(0, 8);
  var cacheKey = nocache ? null : ssId + "_" + type + "_" + (cityParam || "all") + "_s" + sinceParam + "_o" + offset;

  if (cacheKey) {
    var cachedData = getLargeCache(cacheKey);
    if (cachedData) return ContentService.createTextOutput(cachedData).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ss.getSheetByName("Providers") || ss.getSheetByName("Sheet1") || ss.getSheets()[0];
  var lastRow = getLastRowCached(sheet);
  if (lastRow <= 1) return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);

  // --- CASE A: Fetch IDs (For Worker Registry) ---
  if (type === "get_ids") {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String);
    var idsJson = JSON.stringify(ids);
    if (!nocache && cacheKey) putLargeCache(cacheKey, idsJson);
    return ContentService.createTextOutput(idsJson).setMimeType(ContentService.MimeType.JSON);
  }

  // --- CASE B: Fetch Providers (Main Logic) ---
  if (type === "providers") {
    var finalProviders = [];

    // 🚀 TURBO CITY SEARCH: TextFinder implementation (No more loop bottleneck)
    if (cityParam && cityParam.length > 2) {
      var finder = sheet.createTextFinder(cityParam).matchCase(false);
      var results = finder.findAll();
      var rowNums = [];

      for (var i = 0; i < results.length; i++) {
        var col = results[i].getColumn();
        if (col === 7 || col === 8) { // Only G (City) or H (Locality)
           rowNums.push(results[i].getRow());
        }
      }

      // Sorting and Pagination for searched results
      rowNums.sort(function(a, b){return a-b});
      var pagedRows = rowNums.slice(offset, offset + limit);

      pagedRows.forEach(function(rowNum) {
        var rowData = sheet.getRange(rowNum, 1, 1, 31).getValues()[0];
        var p = mapRowToProvider(rowData);
        if (sinceParam > 0) {
          if (p.lastSeen > sinceParam) finalProviders.push(p);
        } else {
          finalProviders.push(p);
        }
      });
    }
    // COORDINATES OR SINCE SEARCH (Fallback to scanning recent 10k rows)
    else if (latParam || sinceParam > 0) {
      var searchLimit = 10000;
      var startIdx = Math.max(2, lastRow - searchLimit);
      var data = sheet.getRange(startIdx, 1, (lastRow - startIdx + 1), 31).getValues();

      for (var i = data.length - 1; i >= 0; i--) {
        var p = mapRowToProvider(data[i]);
        var match = true;
        if (sinceParam > 0 && p.lastSeen <= sinceParam) match = false;

        if (match) {
          if (latParam && lonParam) {
             p.dist = Math.sqrt(Math.pow(latParam - p.latitude, 2) + Math.pow(lonParam - p.longitude, 2));
          }
          finalProviders.push(p);
        }
        if (finalProviders.length >= (offset + limit)) break;
      }
      if (latParam && lonParam) finalProviders.sort(function(a, b) { return a.dist - b.dist; });
      finalProviders = finalProviders.slice(offset, offset + limit);
    }
    // DEFAULT FAST SEQUENTIAL FETCH
    else {
      var startRow = 2 + offset;
      if (startRow <= lastRow) {
        var numRows = Math.min(limit, lastRow - startRow + 1);
        var rows = sheet.getRange(startRow, 1, numRows, 31).getValues();
        finalProviders = rows.map(mapRowToProvider);
      }
    }

    var finalJson = JSON.stringify(finalProviders);
    if (cacheKey && finalProviders.length > 0) putLargeCache(cacheKey, finalJson);
    return ContentService.createTextOutput(finalJson).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- 3. MAIN POST HANDLER ---

/**
 * RAPIDHELP MASTER ENGINE (V70 - DEDUPE FIX)
 * 🚀 FIXED: Now uses ID (Column A) for deduplication to prevent leading-zero issues.
 * 🛡️ STABILITY: Added junk data check.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var data = JSON.parse(e.postData.contents);
    var type = (data.type || "").toUpperCase();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return ContentService.createTextOutput("Error: No SS");
    var sheet = ss.getSheetByName("Providers") || ss.getSheetByName("Sheet1") || ss.getSheets()[0];

    if (type === "BATCH_PROVIDER_SYNC" || type === "PROVIDER_SYNC") {
      var providers = data.providers || [data];
      var lastRow = sheet.getLastRow();

      // 🚀 MASTER DEDUPE MAP: ID Match + Phone Contains Logic
      var idMap = {};
      var phoneMap = {}; // 10-digit phone -> Row index

      if (lastRow > 1) {
        // ID (A), WhatsApp (L-12), Call (M-13) columns cha data ekdach vachne (Performance sathi)
        var dataMatrix = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
        for (var i = 0; i < dataMatrix.length; i++) {
          var rowId = String(dataMatrix[i][0]).trim();     // Column A
          var rowWA = String(dataMatrix[i][11]).trim();    // Column L
          var rowCall = String(dataMatrix[i][12]).trim();  // Column M
          var rNum = i + 2;

          if (rowId) idMap[rowId] = rNum;

          // 📱 'Contains' logic sathi last 10 digits mapping
          var p1 = rowId.replace(/[^0-9]/g, '').slice(-10);
          var p2 = rowWA.replace(/[^0-9]/g, '').slice(-10);
          var p3 = rowCall.replace(/[^0-9]/g, '').slice(-10);

          if (p1.length === 10) phoneMap[p1] = rNum;
          if (p2.length === 10) phoneMap[p2] = rNum;
          if (p3.length === 10) phoneMap[p3] = rNum;
        }
      }

      var rowsToAdd = [];
      var updates = [];

      providers.forEach(function(p) {
        var providerId = String(p.id).trim();
        var incomingPhone = String(p.whatsappNumber || p.id).replace(/[^0-9]/g, '').slice(-10);

        // 🚀 DEDUPE OR CONDITION: Exact ID match OR Phone Number match
        var rowIdx = idMap[providerId] || phoneMap[incomingPhone];

        var rowData = [
          p.id, p.businessName, p.primaryCategoryId, p.subcategory, p.experienceYears,
          p.serviceMode, p.city, p.locality, p.state, p.startingPrice,
          p.priceUnit, p.whatsappNumber, p.callNumber, p.aboutDescription,
          p.isApproved, p.isVerified || false, p.rating || 0.0, p.profilePhotoUrl,
          p.recommendationCount || 0, Array.isArray(p.portfolioUrls) ? p.portfolioUrls.join(",") : (p.portfolioUrls || ""),
          Array.isArray(p.searchKeywords) ? p.searchKeywords.join(",") : (p.searchKeywords || ""),
          p.lastSeen || Date.now(), p.callCount || 0, p.fullAddress || "", p.isNumberHidden || false,
          p.referredBy || "", p.referralBonusPaid || false, p.fcmToken || "", p.notificationsEnabled || false,
          p.latitude || 0, p.longitude || 0
        ];

        if (rowIdx) {
          updates.push({row: rowIdx, data: rowData});
        } else {
          rowsToAdd.push(rowData);
          // Batch madhle duplicates avoid karnyathi maps update karne
          idMap[providerId] = lastRow + rowsToAdd.length + 1;
          if (incomingPhone.length === 10) phoneMap[incomingPhone] = lastRow + rowsToAdd.length + 1;
        }
      });

      if (updates.length > 0) {
        updates.forEach(function(u) { sheet.getRange(u.row, 1, 1, 31).setValues([u.data]); });
      }
      if (rowsToAdd.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 31).setValues(rowsToAdd);
      }
      return ContentService.createTextOutput("Success");
    }

    if (type === "IMAGE_UPDATE") {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ContentService.createTextOutput("Error: No Data");

  var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    if (idValues[i][0].toString() === data.id.toString()) {
      var rowNum = i + 2;
      if (data.profilePhotoUrl) sheet.getRange(rowNum, 18).setValue(data.profilePhotoUrl);
      if (data.portfolioUrls) sheet.getRange(rowNum, 20).setValue(data.portfolioUrls);

      // 🚀 FIX: lastSeen अपडेट करा जेणेकरून सिंक ट्रिगर होईल
      sheet.getRange(rowNum, 22).setValue(Date.now());
      return ContentService.createTextOutput("Success: Image Updated");
    }
  }
  return ContentService.createTextOutput("Error: ID not found");
}

    if (type === "BATCH_IMAGE_UPDATE") {
  var updates = data.updates || [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ContentService.createTextOutput("Error: No Data");

  var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var idRowMap = {};
  for (var i = 0; i < idValues.length; i++) {
    idRowMap[idValues[i][0].toString().trim()] = i + 2;
  }

  var count = 0;
  updates.forEach(function(upd) {
    var rowNum = idRowMap[upd.id.toString().trim()];
    if (rowNum) {
      if (upd.profilePhotoUrl) sheet.getRange(rowNum, 18).setValue(upd.profilePhotoUrl);
      if (upd.portfolioUrls) sheet.getRange(rowNum, 20).setValue(upd.portfolioUrls);

      // 🚀 नवीन: कीवर्ड्स अपडेट करणे (Column U - 21)
      if (upd.searchKeywords) sheet.getRange(rowNum, 21).setValue(upd.searchKeywords);

      // 🚀 महत्त्वाचे: lastSeen अपडेट करा जेणेकरून Grid Sync ला नवीन डेटा सापडेल
      sheet.getRange(rowNum, 22).setValue(Date.now());

      count++;
    }
  });
  return ContentService.createTextOutput("Success: " + count + " Records Updated");
}

if (type === "DELETE_ENTRIES") {
  var idsToDelete = data.ids || [data.id];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ContentService.createTextOutput("Success: No rows");

  var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var idRowMap = {};
  for (var i = 0; i < idValues.length; i++) {
    idRowMap[idValues[i][0].toString().trim()] = i + 2;
  }

  var count = 0;
  idsToDelete.forEach(function(id) {
    var rowNum = idRowMap[String(id).trim()];
    if (rowNum) {
      // 🚀 'Soft Delete' - isApproved (Column 15) FALSE करा
      sheet.getRange(rowNum, 15).setValue(false);
      // 🚀 lastSeen (Column 22) अपडेट करा जेणेकरून GitHub ला कळेल
      sheet.getRange(rowNum, 22).setValue(Date.now());
      count++;
    }
  });
  return ContentService.createTextOutput("Success: Deactivated " + count + " records for sync");
}

    return ContentService.createTextOutput("Done");
  } catch (error) {
    return ContentService.createTextOutput("Error: " + error.toString());
  } finally { lock.releaseLock(); }
}


// --- 4. DATA MAPPING ---

function mapRowToProvider(r) {
  return {
    "id": String(r[0] || ""), "businessName": String(r[1] || ""), "primaryCategoryId": String(r[2] || ""), "subcategory": String(r[3] || ""),
    "experienceYears": parseInt(r[4]) || 0, "serviceMode": String(r[5] || "Local"), "city": String(r[6] || ""), "locality": String(r[7] || ""),
    "state": String(r[8] || ""), "startingPrice": parseInt(r[9]) || 0, "priceUnit": String(r[10] || ""), "whatsappNumber": String(r[11] || ""),
    "callNumber": String(r[12] || ""), "aboutDescription": String(r[13] || ""), "isApproved": (r[14] === true || r[14] === "TRUE"),
    "isVerified": (r[15] === true || r[15] === "TRUE"), "rating": parseFloat(r[16]) || 0.0, "profilePhotoUrl": String(r[17] || ""),
    "recommendationCount": parseInt(r[18]) || 0, "portfolioUrls": r[19] ? r[19].toString().split(",") : [], "searchKeywords": r[20] ? r[20].toString().split(",") : [],
    "lastSeen": parseInt(r[21]) || 0, "callCount": parseInt(r[22]) || 0, "fullAddress": String(r[23] || ""), "isNumberHidden": (r[24] === true || r[24] === "TRUE"),
    "referredBy": String(r[25] || ""), "referralBonusPaid": (r[26] === true || r[26] === "TRUE"), "fcmToken": String(r[27] || ""),
    "notificationsEnabled": (r[28] === true || r[28] === "TRUE"), "latitude": parseFloat(r[29] || 0.0), "longitude": parseFloat(r[30]) || 0.0
  };
}

// --- 5. HYPER-SCALE CACHE HELPERS ---

function putLargeCache(key, value) {
  var cache = CacheService.getScriptCache();
  var chunkSize = 90 * 1024;
  var chunks = [];
  for (var i = 0; i < value.length; i += chunkSize) { chunks.push(value.substring(i, i + chunkSize)); }
  for (var j = 0; j < chunks.length; j++) { cache.put(key + "_" + j, chunks[j], CACHE_TTL); }
  cache.put(key + "_count", chunks.length.toString(), CACHE_TTL);
}

function getLargeCache(key) {
  var cache = CacheService.getScriptCache();
  var count = cache.get(key + "_count");
  if (!count) return null;
  var fullValue = "";
  for (var i = 0; i < parseInt(count); i++) {
    var chunk = cache.get(key + "_" + i);
    if (!chunk) return null;
    fullValue += chunk;
  }
  return fullValue;
}
