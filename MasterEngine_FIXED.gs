/**
 * RAPIDHELP MASTER ENGINE (V72 - FULL REPAIR & DISCOVERY)
 * 🛡️ REPAIR: Fixes Category, Subcat, GPS (30,31), and Missing Fields.
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
          var rowId = String(dataMatrix[i][0]).trim();
          var rowCall = String(dataMatrix[i][12]).trim();
          if (rowId) idMap[rowId] = i + 2;
          var p = rowCall.replace(/[^0-9]/g, '').slice(-10);
          if (p.length === 10) phoneMap[p] = i + 2;
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

      if (updates.length > 0) updates.forEach(function(u) { sheet.getRange(u.row, 1, 1, 31).setValues([u.data]); });
      if (rowsToAdd.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 31).setValues(rowsToAdd);
      return ContentService.createTextOutput("Success");
    }

    if (type === "BATCH_IMAGE_UPDATE" || type === "IMAGE_UPDATE") {
      var updates = data.updates || [data];
      var lastRow = sheet.getLastRow();
      var idValues = sheet.getRange(1, 1, lastRow, 1).getValues().flat().map(String);
      var count = 0;

      updates.forEach(function(upd) {
        var rowNum = idValues.indexOf(String(upd.id).trim()) + 1;
        if (rowNum > 1) {
          // --- 🚀 DEEP REPAIR ---
          if (upd.profilePhotoUrl) sheet.getRange(rowNum, 18).setValue(upd.profilePhotoUrl);
          if (upd.portfolioUrls) sheet.getRange(rowNum, 20).setValue(upd.portfolioUrls);
          if (upd.searchKeywords) sheet.getRange(rowNum, 21).setValue(upd.searchKeywords);
          if (upd.primaryCategoryId) sheet.getRange(rowNum, 3).setValue(upd.primaryCategoryId);
          if (upd.subcategory) sheet.getRange(rowNum, 4).setValue(upd.subcategory);
          if (upd.latitude) sheet.getRange(rowNum, 30).setValue(upd.latitude);
          if (upd.longitude) sheet.getRange(rowNum, 31).setValue(upd.longitude);
          if (upd.fullAddress) sheet.getRange(rowNum, 24).setValue(upd.fullAddress);
          sheet.getRange(rowNum, 22).setValue(Date.now());
          count++;
        }
      });
      return ContentService.createTextOutput("Success: Repaired " + count);
    }

    if (type === "DELETE_ENTRIES") {
      var ids = data.ids || [data.id];
      var idValues = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().flat().map(String);
      ids.forEach(function(id) {
        var rowNum = idValues.indexOf(String(id).trim()) + 1;
        if (rowNum > 1) {
          sheet.getRange(rowNum, 15).setValue(false); // isApproved = FALSE
          sheet.getRange(rowNum, 22).setValue(Date.now());
        }
      });
      return ContentService.createTextOutput("Deactivated");
    }
    return ContentService.createTextOutput("Done");
  } catch (e) { return ContentService.createTextOutput("Error: " + e.toString()); }
  finally { lock.releaseLock(); }
}
