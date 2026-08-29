/**
 * RAPIDHELP MASTER ENGINE (V71 - DATA REPAIR EDITION)
 * 🚀 PERFORMANCE: TextFinder + Batch I/O.
 * 🛡️ REPAIR: Now repairs bad/missing fields (Category, Coords, Price) during Image Update.
 * 🛡️ DEDUPE: Column A based ID tracking with 10-digit phone normalization.
 * Author: Sandesh Koli (RapidHelp)
 */

var CACHE_TTL = 900;
var _lrCache = { val: 0, time: 0 };

function getLastRowCached(sheet) {
  if (!sheet) return 0;
  var now = Date.now();
  if (now - _lrCache.time < 5000 && _lrCache.val > 0) return _lrCache.val;
  try {
    var lr = sheet.getLastRow();
    _lrCache = { val: lr, time: now };
    return lr;
  } catch (e) { return 0; }
}

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
      var idMap = {};
      var phoneMap = {};

      if (lastRow > 1) {
        var dataMatrix = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
        for (var i = 0; i < dataMatrix.length; i++) {
          var rowId = String(dataMatrix[i][0]).trim();
          var rowCall = String(dataMatrix[i][12]).trim();
          var rNum = i + 2;
          if (rowId) idMap[rowId] = rNum;
          var p = rowCall.replace(/[^0-9]/g, '').slice(-10);
          if (p.length === 10) phoneMap[p] = rNum;
        }
      }

      var rowsToAdd = [];
      var updates = [];

      providers.forEach(function(p) {
        var providerId = String(p.id).trim();
        var incomingPhone = String(p.whatsappNumber || p.id).replace(/[^0-9]/g, '').slice(-10);
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

        if (rowIdx) updates.push({row: rowIdx, data: rowData});
        else {
          rowsToAdd.push(rowData);
          idMap[providerId] = lastRow + rowsToAdd.length + 1;
        }
      });

      if (updates.length > 0) { updates.forEach(function(u) { sheet.getRange(u.row, 1, 1, 31).setValues([u.data]); }); }
      if (rowsToAdd.length > 0) { sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 31).setValues(rowsToAdd); }
      return ContentService.createTextOutput("Success");
    }

    if (type === "BATCH_IMAGE_UPDATE") {
      var updates = data.updates || [];
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) return ContentService.createTextOutput("Error: No Data");

      var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      var idRowMap = {};
      for (var i = 0; i < idValues.length; i++) { idRowMap[idValues[i][0].toString().trim()] = i + 2; }

      var count = 0;
      updates.forEach(function(upd) {
        var rowNum = idRowMap[upd.id.toString().trim()];
        if (rowNum) {
          // --- 🚀 REPAIR LOGIC: Update EVERYTHING found ---
          if (upd.profilePhotoUrl) sheet.getRange(rowNum, 18).setValue(upd.profilePhotoUrl);
          if (upd.portfolioUrls) sheet.getRange(rowNum, 20).setValue(upd.portfolioUrls);
          if (upd.searchKeywords) sheet.getRange(rowNum, 21).setValue(upd.searchKeywords);

          // Fix Category & GPS (Columns 3, 4, 30, 31)
          if (upd.primaryCategoryId) sheet.getRange(rowNum, 3).setValue(upd.primaryCategoryId);
          if (upd.subcategory) sheet.getRange(rowNum, 4).setValue(upd.subcategory);
          if (upd.latitude && upd.latitude > 5) sheet.getRange(rowNum, 30).setValue(upd.latitude);
          if (upd.longitude && upd.longitude > 5) sheet.getRange(rowNum, 31).setValue(upd.longitude);

          // Fix Missing Fields (5, 6, 10, 11, 14, 24)
          if (upd.experienceYears) sheet.getRange(rowNum, 5).setValue(upd.experienceYears);
          if (upd.serviceMode) sheet.getRange(rowNum, 6).setValue(upd.serviceMode);
          if (upd.startingPrice !== undefined) sheet.getRange(rowNum, 10).setValue(upd.startingPrice);
          if (upd.priceUnit) sheet.getRange(rowNum, 11).setValue(upd.priceUnit);
          if (upd.aboutDescription) sheet.getRange(rowNum, 14).setValue(upd.aboutDescription);
          if (upd.fullAddress) sheet.getRange(rowNum, 24).setValue(upd.fullAddress);
          if (upd.city) sheet.getRange(rowNum, 7).setValue(upd.city);
          if (upd.locality) sheet.getRange(rowNum, 8).setValue(upd.locality);

          sheet.getRange(rowNum, 22).setValue(Date.now());
          count++;
        }
      });
      return ContentService.createTextOutput("Success: " + count + " Records Repaired");
    }

    if (type === "DELETE_ENTRIES") {
      var idsToDelete = data.ids || [data.id];
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) return ContentService.createTextOutput("Success: No rows");
      var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      var idRowMap = {};
      for (var i = 0; i < idValues.length; i++) { idRowMap[String(idValues[i][0]).trim()] = i + 2; }
      idsToDelete.forEach(function(id) {
        var rowNum = idRowMap[String(id).trim()];
        if (rowNum) { sheet.getRange(rowNum, 15).setValue(false); sheet.getRange(rowNum, 22).setValue(Date.now()); }
      });
      return ContentService.createTextOutput("Success");
    }
    return ContentService.createTextOutput("Done");
  } catch (error) { return ContentService.createTextOutput("Error: " + error.toString()); }
  finally { lock.releaseLock(); }
}
