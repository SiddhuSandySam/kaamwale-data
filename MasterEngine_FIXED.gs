/**
 * RAPIDHELP MASTER ENGINE (V73 - FULL COLUMN REPAIR)
 * 🛡️ REPAIR: Fixes ALL Columns during Update (C, D, E, F, G, H, J, K, N, R, T, U, X, AD, AE).
 * 🛡️ DEDUPE: 10-digit phone normalization.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var data = JSON.parse(e.postData.contents);
    var type = (data.type || "").toUpperCase();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Providers") || ss.getSheets()[0];

    if (type === "BATCH_PROVIDER_SYNC" || type === "PROVIDER_SYNC") {
      var providers = data.providers || [data];
      var lastRow = sheet.getLastRow();
      var idMap = {};
      var phoneMap = {};
      if (lastRow > 1) {
        var dataMatrix = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
        for (var i = 0; i < dataMatrix.length; i++) {
          idMap[String(dataMatrix[i][0]).trim()] = i + 2;
          var p = String(dataMatrix[i][12]).replace(/[^0-9]/g, '').slice(-10);
          if (p.length === 10) phoneMap[p] = i + 2;
        }
      }
      var rowsToAdd = [];
      providers.forEach(function(p) {
        var providerId = String(p.id).trim();
        var inPhone = String(p.whatsappNumber || p.id).replace(/[^0-9]/g, '').slice(-10);
        var rowIdx = idMap[providerId] || phoneMap[inPhone];
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
        if (rowIdx) sheet.getRange(rowIdx, 1, 1, 31).setValues([rowData]);
        else rowsToAdd.push(rowData);
      });
      if (rowsToAdd.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 31).setValues(rowsToAdd);
      return ContentService.createTextOutput("Success");
    }

    if (type === "BATCH_IMAGE_UPDATE" || type === "IMAGE_UPDATE") {
      var updates = data.updates || [data];
      var lastRow = sheet.getLastRow();
      var idValues = sheet.getRange(1, 1, lastRow, 1).getValues().flat().map(String);
      var repaired = 0;

      updates.forEach(function(upd) {
        var rowNum = idValues.indexOf(String(upd.id).trim()) + 1;
        if (rowNum > 1) {
          // --- 🚀 REPAIR ALL FIELDS ---
          if (upd.primaryCategoryId) sheet.getRange(rowNum, 3).setValue(upd.primaryCategoryId);
          if (upd.subcategory) sheet.getRange(rowNum, 4).setValue(upd.subcategory);
          if (upd.experienceYears) sheet.getRange(rowNum, 5).setValue(upd.experienceYears);
          if (upd.serviceMode) sheet.getRange(rowNum, 6).setValue(upd.serviceMode);
          if (upd.city) sheet.getRange(rowNum, 7).setValue(upd.city);
          if (upd.locality) sheet.getRange(rowNum, 8).setValue(upd.locality);
          if (upd.startingPrice !== undefined) sheet.getRange(rowNum, 10).setValue(upd.startingPrice);
          if (upd.priceUnit) sheet.getRange(rowNum, 11).setValue(upd.priceUnit);
          if (upd.aboutDescription) sheet.getRange(rowNum, 14).setValue(upd.aboutDescription);
          if (upd.profilePhotoUrl) sheet.getRange(rowNum, 18).setValue(upd.profilePhotoUrl);
          if (upd.portfolioUrls) sheet.getRange(rowNum, 20).setValue(upd.portfolioUrls);
          if (upd.searchKeywords) sheet.getRange(rowNum, 21).setValue(upd.searchKeywords);
          if (upd.fullAddress) sheet.getRange(rowNum, 24).setValue(upd.fullAddress);
          if (upd.latitude) sheet.getRange(rowNum, 30).setValue(upd.latitude);
          if (upd.longitude) sheet.getRange(rowNum, 31).setValue(upd.longitude);
          sheet.getRange(rowNum, 22).setValue(Date.now());
          repaired++;
        }
      });
      return ContentService.createTextOutput("Success: Repaired " + repaired);
    }

    if (type === "DELETE_ENTRIES") {
      var ids = data.ids || [data.id];
      var idValues = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().flat().map(String);
      ids.forEach(function(id) {
        var rowNum = idValues.indexOf(String(id).trim()) + 1;
        if (rowNum > 1) { sheet.getRange(rowNum, 15).setValue(false); sheet.getRange(rowNum, 22).setValue(Date.now()); }
      });
      return ContentService.createTextOutput("Deactivated");
    }
    return ContentService.createTextOutput("Done");
  } catch (error) { return ContentService.createTextOutput("Error: " + error.toString()); }
  finally { lock.releaseLock(); }
}
