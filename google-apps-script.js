/* 
  CONFIGURATION 
  Replace with your specific Calendar ID if not using primary 
*/
const CALENDAR_ID = 'primary'; 
const DRIVE_FOLDER_NAME = 'Client Bookings';
const SPREADSHEET_ID = '1R81HIyxwHuAyvlBBQ8KHUVPa6N7pZnWiDDcLOe5qUrE';
const SHEET_GID = '0';

// LOGGING CONFIGURATION
const LOG_SPREADSHEET_ID = '1Q2-FH5SA7ESvHawriZF3DMbI_8wrIyuGWMsZ2tb9QxQ';
const LOG_SHEET_NAME = 'Sheet1'; // Default sheet name for logs

// TELEGRAM CONFIGURATION
const TG_TOKEN = '8448746916:AAHHJNuXubpjFfMsIDV08OcP8DyXlpQA9RE';
const TG_CHAT_ID = '662703816'; // Target chat ID for @Hanna_Leads_Bot

// Get the deployed web app URL (used to generate "Add to Sheet" links)
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function doGet(e) {
  // Guard against manual execution in the editor without event object
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("Error: No parameters provided. This function should be triggered via Web App URL.")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  
  const action = e.parameter.action;

  // Action: Add client to spreadsheet
  if (action === 'addToSheet' || e.parameter.act === 'addToSheet') {
    return addClientToSheet(e.parameter);
  }

  // Default: Return free calendar slots
  const year = parseInt(e.parameter.year);
  const month = parseInt(e.parameter.month); // 0-indexed (0 = Jan)
  
  return ContentService.createTextOutput(
    JSON.stringify(getFreeSlots(year, month))
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // --- Action: Site Usage Logging ---
    if (data.action === 'log') {
      return ContentService.createTextOutput(JSON.stringify(logUsage(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- Action: Live Draft Saving ---
    if (data.action === 'draft') {
      return ContentService.createTextOutput(JSON.stringify(logDraft(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --- Anti-bot: honeypot check ---
    if (data._honeypot && data._honeypot.trim() !== '') {
      logUsage({
        event: 'SUSPICIOUS: Honeypot Triggered',
        details: `Name: ${data.name}, Email: ${data.email}`,
        userInfo: data.userInfo || '',
        fingerprint: data.fingerprint || '',
        suspicious: true
      });
      return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Invalid submission.'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // --- Anti-bot: timestamp check (reject if submitted in < 3 seconds) ---
    if (data._timestamp) {
      const elapsed = Date.now() - parseInt(data._timestamp, 10);
      if (elapsed < 3000) {
        logUsage({
          event: 'SUSPICIOUS: Rapid Submission',
          details: `Elapsed: ${elapsed}ms`,
          userInfo: data.userInfo || '',
          fingerprint: data.fingerprint || '',
          suspicious: true
        });
        return ContentService.createTextOutput(JSON.stringify({success: false, error: 'Submission too fast.'}))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    const result = bookSlot(data);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Helper: Interpret a wall-clock time as an America/Toronto Date object.
 * Regardless of the script's timezone setting, this returns a point in time
 * that corresponds to the given parts in Toronto.
 */
function getTorontoDate(year, month, day, hour, minute) {
  const date = new Date(year, month, day, hour || 0, minute || 0);
  const offset = Utilities.formatDate(date, 'America/Toronto', 'Z'); // e.g. "-0400"
  const formattedOffset = offset.slice(0, 3) + ":" + offset.slice(3);
  
  // Format: YYYY-MM-DDTHH:mm:ss-05:00
  const isoStr = year + "-" + 
                 String(month + 1).padStart(2, '0') + "-" + 
                 String(day).padStart(2, '0') + "T" + 
                 String(hour || 0).padStart(2, '0') + ":" + 
                 String(minute || 0).padStart(2, '0') + ":00" + 
                 formattedOffset;
  return new Date(isoStr);
}

function getFreeSlots(year, month) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const endDate = new Date(year, month + 1, 0);
  
  const startHours = [10, 12, 14, 16];
  const availableSlots = [];
  const now = new Date(); 
  
  for (let d = 1; d <= endDate.getDate(); d++) {
    const checkDate = getTorontoDate(year, month, d, 0, 0);
    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek === 0) continue; // Skip Sundays (0)
    
    startHours.forEach(h => {
      const slotStart = getTorontoDate(year, month, d, h, 0);
      const slotEnd = getTorontoDate(year, month, d, h, 50); // 50 minutes duration
      
      if (slotStart < now) return; // Skip past slots
      
      const events = calendar.getEvents(slotStart, slotEnd).filter(e => {
        const title = e.getTitle().toLowerCase();
        // Ignore anything that looks like a Google Appointment block
        return !title.includes('appointment') && !title.includes('schedule');
      });

      const isoLocal = year + '-' +
        String(month + 1).padStart(2, '0') + '-' +
        String(d).padStart(2, '0') + 'T' +
        String(h).padStart(2, '0') + ':00:00';

      availableSlots.push({
        date: d,
        text: `${formatTime(h, 0)} – ${formatTime(h, 50)}`, // En dash
        iso: isoLocal,
        status: events.length === 0 ? 'free' : 'busy'
      });
    });
  }
  
  return { success: true, slots: availableSlots };
}

function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

function saveClientDataAndFiles(data) {
  const parentFolder = getOrCreateFolder(DRIVE_FOLDER_NAME);
  // Use a timestamp to ensure uniqueness and sorting
  const timestamp = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd_HH-mm-ss');
  // Sanitize name for folder
  const safeName = (data.name || 'Client').replace(/[^a-zA-Z0-9 ]/g, "").trim();
  const subFolderName = `${timestamp} - ${safeName}`;
  const clientFolder = parentFolder.createFolder(subFolderName);

  const uploadedFiles = [];

  // 1. Create Text Document with Client Info
  let infoContent = 'CLIENT BOOKING DETAILS\n';
  infoContent += '======================\n\n';
  infoContent += `Name: ${data.name}\n`;
  infoContent += `Phone: ${data.phone}\n`;
  infoContent += `Email: ${data.email}\n`;
  infoContent += `Date Requested: ${data.dateStr}\n`;
  if(data.service) infoContent += `Service: ${data.service}\n`;
  if(data.occupation) infoContent += `Occupation: ${data.occupation}\n`;
  if(data.dob) infoContent += `DOB: ${data.dob}\n`;
  if(data.address) infoContent += `Address: ${data.address}\n`;
  infoContent += `\n----------------------\n`;
  infoContent += `NOTES:\n${data.notes || 'None'}\n`;
  infoContent += `----------------------\n\n`;
  infoContent += `Technical Info:\n`;
  infoContent += `User Agent: ${data.userInfo || 'Unknown'}\n`;
  infoContent += `Fingerprint: ${data.fingerprint || 'Unknown'}\n`;

  const textFile = clientFolder.createFile('Client_Info.txt', infoContent);
  // Default Drive restrictions apply: users must request access from owner to view.
  
  uploadedFiles.push({
      name: 'Client_Info.txt',
      url: textFile.getUrl()
  });

  // 2. Process Attachments
  if (data.files && Array.isArray(data.files) && data.files.length > 0) {
    for (const file of data.files) {
        try {
            const decoded = Utilities.base64Decode(file.data);
            const blob = Utilities.newBlob(decoded, file.type, file.name);
            const driveFile = clientFolder.createFile(blob);
            
            uploadedFiles.push({
                name: file.name,
                url: driveFile.getUrl()
            });
        } catch(e) {
            Logger.log("Error saving file: " + e.toString());
        }
    }
  }
  
  return uploadedFiles;
}

function bookSlot(data) {
  // --- Input validation ---
  if (!data.name || !data.name.trim()) throw new Error('Name is required.');
  if (!data.email || !data.email.trim()) throw new Error('Email is required.');
  if (!data.phone || !data.phone.trim()) throw new Error('Phone is required.');
  if (!data.dateStr || !data.dateStr.trim()) throw new Error('Date is required.');

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    throw new Error('Invalid email format.');
  }

  // Validate dateStr format (expect YYYY-MM-DDTHH:MM or similar)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.dateStr.trim())) {
    throw new Error('Invalid date format.');
  }

  // Limit notes length
  if (data.notes && data.notes.length > 2000) {
    data.notes = data.notes.substring(0, 2000);
  }

  // --- Conflict Check ---
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const names = sheet.getRange(2, 3, lastRow - 1, 1).getValues(); // Column C is Name
      const incomingName = (data.name || '').trim().toLowerCase();
      for (var i = 0; i < names.length; i++) {
        if (names[i][0].toString().trim().toLowerCase() === incomingName) {
           return { success: false, error: 'CONFLICT_CHECK', message: 'Representation Warning: A client with this name is already in our records. To prevent potential conflicts of interest, please contact us by phone to clarify.' };
        }
      }
    }
  } catch(e) { Logger.log("Conflict Check Error: " + e.message); }

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  
  const parts = data.dateStr.split(/[-T:]/);
  const startTime = getTorontoDate(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
    parseInt(parts[3]),
    parseInt(parts[4])
  );
  
  const endTime = new Date(startTime.getTime() + (50 * 60 * 1000)); // 50 minutes later

  const uploadedFiles = saveClientDataAndFiles(data);

  // Build description
  let description = '';
  description += `Client: ${data.name}\n`;
  description += `Phone: ${data.phone}\n`;
  description += `Email: ${data.email}\n`;
  if (data.service) description += `Service: ${data.service}\n`;
  if (data.occupation) description += `Occupation: ${data.occupation}\n`;
  if (data.dob) description += `DOB: ${data.dob}\n`;
  if (data.address) description += `Address: ${data.address}\n`;
  if (data.notes) description += `\nNotes: ${data.notes}\n`;

  // File links
  if (uploadedFiles.length > 0) {
    description += `\n--- Attached Files ---\n`;
    uploadedFiles.forEach((f, i) => {
      description += `${i + 1}. ${f.name}: ${f.url}\n`;
    });
  }

  // Generate "Add to Spreadsheet" link for the calendar event
  const scriptUrl = getScriptUrl();
  const createdAt = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm');
  const fileLinksStr = uploadedFiles.map(f => `${f.name}: ${f.url}`).join('\n');

  const sheetParamsObj = {
    act: 'addToSheet',
    n: data.name || '',
    ph: data.phone || '',
    e: data.email || '',
    srv: data.service || '',
    occ: data.occupation || '',
    d: data.dob || '',
    adr: data.address || '',
    nt: data.notes || '',
    dt: data.dateStr || '',
    c: createdAt,
    f: fileLinksStr
  };

  const queryString = Object.keys(sheetParamsObj)
    .map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(sheetParamsObj[key]);
    })
    .join('&');

  const addToSheetLink = scriptUrl + '?' + queryString;

  description += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  description += `📋 ADD CLIENT TO DATABASE:\n`;
  description += addToSheetLink + `\n`;

  const title = `Consultation: ${data.name}`;

  calendar.createEvent(title, startTime, endTime, {
    description: description
  });

  // SEND BEAUTIFUL INTAKE EMAIL
  try {
    sendIntakeEmail(data, addToSheetLink, uploadedFiles);
  } catch(e) {
    Logger.log("Email Delivery Error: " + e.message);
  }

  // SEND TELEGRAM NOTIFICATION
  try {
    sendTelegram(data);
  } catch(e) {
    Logger.log("Telegram Error: " + e.message);
  }

  return { success: true };
}

function sendTelegram(data) {
  const message = "🎯 *NEW LEAD RECEIVED!*\n\n" +
    "👤 *Name:* " + data.name + "\n" +
    "📧 *Email:* " + data.email + "\n" +
    "📞 *Phone:* " + data.phone + "\n" +
    "💼 *Service:* " + data.service + "\n" +
    "📅 *Date:* " + data.dateStr;
    
  const url = "https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage";
  const payload = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    })
  };
  UrlFetchApp.fetch(url, payload);
}

/**
 * Adds client data to the Google Spreadsheet and returns a confirmation page.
 */
function addClientToSheet(params) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // Find the sheet by GID
    const sheets = ss.getSheets();
    let targetSheet = null;
    for (const sheet of sheets) {
      if (sheet.getSheetId().toString() === SHEET_GID) {
        targetSheet = sheet;
        break;
      }
    }
    
    if (!targetSheet) {
      targetSheet = ss.getSheets()[0]; // Fallback to first sheet
    }

    // Append new row mapping short keys
    targetSheet.appendRow([
      params.c || params.created || '',
      params.dt || params.date || '',
      params.n || params.name || '',
      params.ph || params.phone || '',
      params.e || params.email || '',
      params.srv || params.service || '',
      params.occ || params.occupation || '',
      params.d || params.dob || '',
      params.adr || params.address || '',
      params.nt || params.notes || '',
      params.f || params.files || ''
    ]);

    // Return a self-closing HTML confirmation page
    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; display: flex; justify-content: center; 
                   align-items: center; min-height: 100vh; background: #1a1a1a; color: #fff; margin: 0; }
            .card { background: #2a2a2a; border-radius: 16px; padding: 40px; text-align: center; max-width: 300px; }
            h2 { color: #4CAF50; margin-bottom: 10px; font-size: 1.2rem; }
            p { color: #ccc; font-size: 0.9rem; }
          </style>
          <script>
            setTimeout(() => {
              window.close();
            }, 1500);
          </script>
        </head>
        <body>
          <div class="card">
            <h2>✅ Client Added</h2>
            <p>Closing this tab...</p>
          </div>
        </body>
      </html>`;

    return HtmlService.createHtmlOutput(html);

  } catch (err) {
    const errorHtml = `
      <html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;color:#fff;margin:0;">
        <div style="background:#2a2a2a;border-radius:16px;padding:40px;text-align:center;max-width:300px;">
          <h2 style="color:#f44336;font-size:1.1rem;">❌ Error</h2>
          <p style="color:#ccc;font-size:0.9rem;">${escapeHtml(err.message)}</p>
        </div>
      </body></html>`;
    return HtmlService.createHtmlOutput(errorHtml);
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function formatTime(hour, minutes) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h = hour % 12 || 12;
  const mm = minutes ? String(minutes).padStart(2, '0') : '00';
  return `${h}:${mm} ${ampm}`;
}

function testDriveAccess() {
  var folder = getOrCreateFolder('Client Bookings');
  Logger.log('OK! Folder: ' + folder.getUrl());
}

function testSheetAccess() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheets()[0];
  Logger.log('OK! Sheet name: ' + sheet.getName());
}

/**
 * Helper to determine row color based on fingerprint hash.
 */
function getFingerprintColor(fingerprint) {
  const fp = fingerprint || 'unknown';
  let hash = 0;
  for (let i = 0; i < fp.length; i++) {
      hash = fp.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  let rBase = (hash >> 16) & 0xFF;
  let gBase = (hash >> 8) & 0xFF;
  let bBase = hash & 0xFF;

  // Default generative pastel mix
  let r = Math.floor(rBase / 2) + 127;
  let g = Math.floor(gBase / 2) + 127;
  let b = Math.floor(bBase / 2) + 127;

  // Convert to hex
  const toHex = (n) => {
      const hex = n.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
  };

  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/**
 * Logs website usage events to a dedicated spreadsheet.
 */
function logUsage(data) {
  try {
    const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.getSheets()[0]; // Fallback
    }

    const timestamp = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm:ss');
    
    // Log structure: [Timestamp, Event Type, Description, IP Address, Device Info, Fingerprint, Geolocation]
    sheet.appendRow([
      timestamp,
      data.event || 'Generic Event',
      data.details || '',
      '', // IP column removed
      data.userInfo || '',
      data.fingerprint || '',
      data.mapsLink || ''
    ]);

    // Apply bold formatting based on severity or suspicious flag
    const lastRow = sheet.getLastRow();
    const range = sheet.getRange(lastRow, 1, 1, 7); // Format all 7 columns
    
    // Always apply the user's background color so all events share the same visual grouping
    const bgColor = getFingerprintColor(data.fingerprint);
    range.setBackground(bgColor);

    if (data.suspicious || data.severity === 'critical') {
      range.setFontColor("#ff0000").setFontWeight("bold");
    } else if (data.severity === 'warning') {
      range.setFontColor("#ffa500").setFontWeight("bold");
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Logs live form drafting data to the spreadsheet.
 */
function logDraft(data) {
  try {
    const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.getSheets()[0]; // Fallback
    }

    const timestamp = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm:ss');
    const details = `Name: ${data.name || ''} | Email: ${data.email || ''} | Phone: ${data.phone || ''} | Service: ${data.service || ''} | Notes: ${data.notes || ''}`;
    
    // Log structure: [Timestamp, Event Type, Description, IP Address, Device Info, Fingerprint, Geolocation]
    sheet.appendRow([
      timestamp,
      'DRAFT (Live Typing)',
      details,
      '', // IP column removed
      data.userInfo || '',
      data.fingerprint || '',
      data.mapsLink || ''
    ]);

    // Apply color based on fingerprint
    const color = getFingerprintColor(data.fingerprint);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 7).setBackground(color);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Sends a beautifully formatted HTML email to the intake alias containing all client details
 * and providing "Accept Intake" and "Politely Decline" action buttons.
 */
function sendIntakeEmail(data, addToSheetLink, uploadedFiles) {
  const recipient = "paralegal@hannadunchenko.com";
  let alias = "intake@hannadunchenko.com";
  
  // Helper to prevent HTML injection in emails
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Verify alias exists on this Google account
  const aliases = GmailApp.getAliases();
  let useAlias = aliases.includes(alias);

  let fileHtml = '';
  if (uploadedFiles && uploadedFiles.length > 0) {
    fileHtml = '<div style="margin-top:20px; padding-top:20px; border-top: 1px solid rgba(255,255,255,0.1);">';
    fileHtml += '<h3 style="color:#D4B89A; margin-bottom: 15px; font-size: 14px; text-transform: uppercase;">Attached Files</h3>';
    uploadedFiles.forEach((f, i) => {
      fileHtml += `<div style="margin-bottom:10px;"><a href="${f.url}" style="color:#ffffff; text-decoration: none; display: inline-block; padding: 10px 15px; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; font-size: 14px;">📄 ${f.name}</a></div>`;
    });
    fileHtml += '</div>';
  }

  const declineBody = 'Dear ' + data.name + ',\n\n' +
    'I am writing to you regarding the consultation inquiry you recently submitted to Hanna Dunchenko Paralegal Services.\n\n' +
    'I have carefully reviewed your request. Unfortunately, after assessing the current capacity of the practice and the specific nature of your matter, I must respectfully decline to take on your case at this time.\n\n' +
    'Please note that this does not constitute a legal opinion on the merits of your matter. As legal proceedings often have strict statutory limitation periods, I strongly recommend that you consult with another licensed paralegal or lawyer promptly to ensure your rights are protected. You may utilize the Law Society of Ontario\'s Referral Service to assist you in finding appropriate representation.\n\n' +
    'Thank you for reaching out, and I wish you the best in resolving your matter.\n\n' +
    'Sincerely,\n\n' +
    'Hanna Dunchenko\nLicensed Paralegal\nHanna Dunchenko Paralegal Services';
  
  const mailtoLink = 'mailto:' + data.email + '?subject=' + encodeURIComponent('Consultation Inquiry - Hanna Dunchenko Paralegal Services') + '&body=' + encodeURIComponent(declineBody);

  let htmlBody = '' +
    '<div style="font-family: \'Helvetica Neue\', Arial, sans-serif; background-color: #1a1614; color: #ffffff; padding: 40px 20px; line-height: 1.6;">' +
      '<div style="max-width: 600px; margin: 0 auto; background-color: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">' +
        
        '<div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 25px; margin-bottom: 30px;">' +
          '<h1 style="margin: 0; color: #D4B89A; font-size: 26px; font-weight: 300; letter-spacing: 2px; text-transform: uppercase;">New Intake Request</h1>' +
          '<p style="margin: 10px 0 0; font-size: 15px; opacity: 0.7;">Submitted for: ' + escapeHtml(data.dateStr) + '</p>' +
        '</div>' +

        '<table style="width: 100%; border-collapse: collapse;">' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); width: 35%; color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">Client Name</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 15px;">' + escapeHtml(data.name) + '</td></tr>' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">Phone</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05);"><a href="tel:' + escapeHtml(data.phone) + '" style="color: #ffffff; text-decoration: none; font-size: 15px;">' + escapeHtml(data.phone) + '</a></td></tr>' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">Email</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05);"><a href="mailto:' + escapeHtml(data.email) + '" style="color: #ffffff; text-decoration: none; font-size: 15px;">' + escapeHtml(data.email) + '</a></td></tr>' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">Service</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 15px;">' + (escapeHtml(data.service) || 'N/A') + '</td></tr>' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">Occupation</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 15px;">' + (escapeHtml(data.occupation) || 'N/A') + '</td></tr>' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">DOB</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 15px;">' + (escapeHtml(data.dob) || 'N/A') + '</td></tr>' +
          '<tr><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: #D4B89A; font-weight: bold; font-size: 13px; text-transform: uppercase;">Address</td><td style="padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 15px;">' + (escapeHtml(data.address) || 'N/A') + '</td></tr>' +
        '</table>';

  if (data.notes) {
    htmlBody += '<div style="margin-top: 25px;"><h3 style="color:#D4B89A; margin-bottom: 10px; font-size: 14px; text-transform: uppercase;">Client Notes</h3><div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 6px; font-style: italic; font-size: 15px; white-space: pre-wrap;">' + escapeHtml(data.notes) + '</div></div>';
  }
  
  htmlBody += fileHtml;

  htmlBody += '' +
        '<div style="margin-top: 50px; text-align: center;">' +
          '<a href="' + addToSheetLink + '" style="display: block; width: 100%; box-sizing: border-box; background-color: #D4B89A; color: #1a1614; padding: 18px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px;">✓ Accept Intake (Log to Sheet)</a>' +
          
          '<a href="' + mailtoLink + '" style="display: block; width: 100%; box-sizing: border-box; background-color: transparent; color: #ffffff; border: 1px solid rgba(255,255,255,0.3); padding: 18px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px; text-transform: uppercase; letter-spacing: 1px;">⊘ Politely Decline</a>' +
        '</div>' +
        
        '<p style="text-align: center; font-size: 12px; margin-top: 30px; opacity: 0.5;">This automated email was generated by your paralegal booking infrastructure.</p>' +

      '</div>' +
    '</div>';

  const options = {
    htmlBody: htmlBody,
    replyTo: data.email,
    name: "🚨 NEW INTAKE - " + data.name
  };

  try {
    GmailApp.sendEmail(recipient, "New Intake Request: " + data.name, "Please view this email in an HTML client.", options);
  } catch (err) {
    Logger.log("CRITICAL EMAIL ERROR: " + err.message);
  }
}
