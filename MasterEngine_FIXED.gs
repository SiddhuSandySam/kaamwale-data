/**
 * RAPIDHELP MASTER ENGINE (V67 - DEDUPE FIX)
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
    var sheet = ss.getSheetByName("Providers") || ss.getSheets()[0];

    if (type === "BATCH_PROVIDER_SYNC" || type === "PROVIDER_SYNC") {
      var providers = data.providers || [data];
      var lastRow = sheet.getLastRow();

      // 🚀 MASTER DEDUPE MAP: Using IDs (Column A) is 100% reliable
      var idMap = {};
      if (lastRow > 1) {
        var idValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < idValues.length; i++) {
          var id = String(idValues[i][0]).trim();
          if (id) idMap[id] = i + 2;
        }
      }

      var rowsToAdd = [];
      var updates = [];

      providers.forEach(function(p) {
        var providerId = String(p.id).trim();
        var rowIdx = idMap[providerId];

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

      if (updates.length > 0) {
        updates.forEach(function(u) { sheet.getRange(u.row, 1, 1, 31).setValues([u.data]); });
      }
      if (rowsToAdd.length > 0) {
        sheet.getRange(lastRow + 1, 1, rowsToAdd.length, 31).setValues(rowsToAdd);
      }
      return ContentService.createTextOutput("Success");
    }

    if (type === "IMAGE_UPDATE") {
      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) return ContentService.createTextOutput("Error: No Data");

      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0].toString() === data.id.toString()) {
          var rowNum = i + 2;
          if (data.profilePhotoUrl) sheet.getRange(rowNum, 18).setValue(data.profilePhotoUrl);
          if (data.portfolioUrls) sheet.getRange(rowNum, 20).setValue(data.portfolioUrls);
          return ContentService.createTextOutput("Success: Image Updated");
        }
      }
      return ContentService.createTextOutput("Error: ID not found");
    }
    return ContentService.createTextOutput("Done");
  } catch (error) {
    return ContentService.createTextOutput("Error: " + error.toString());
  } finally { lock.releaseLock(); }
}
