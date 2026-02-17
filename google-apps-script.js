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

// Get the deployed web app URL (used to generate "Add to Sheet" links)
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function doGet(e) {
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

    // --- Anti-bot: honeypot check ---
    if (data._honeypot && data._honeypot.trim() !== '') {
      logUsage({
        event: 'SUSPICIOUS: Honeypot Triggered',
        details: `Name: ${data.name}, Email: ${data.email}`,
        userInfo: data.userInfo || '',
        ip: data.ip || '',
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
          ip: data.ip || '',
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
  
  const startHour = 10;
  const endHour = 16;
  const availableSlots = [];
  
  // Get current time in Toronto as an absolute point in time
  const now = new Date(); 
  
  for (let d = 1; d <= endDate.getDate(); d++) {
    const currentDayEnum = getTorontoDate(year, month, d, 0, 0).getDay();
    if (currentDayEnum === 0) continue; // Skip Sundays
    
    for (let h = startHour; h < endHour; h++) {
      const slotStart = getTorontoDate(year, month, d, h, 0);
      const slotEnd = getTorontoDate(year, month, d, h + 1, 0);
      
      // Skip if slot is in the past
      if (slotStart < now) continue;
      
      const events = calendar.getEvents(slotStart, slotEnd).filter(e => {
        const title = e.getTitle();
        return title !== 'Bookable Appointment' && title !== 'Appointment Schedule';
      });
      // isoLocal is a "wall time" string without TZ, used for round-trip
      const isoLocal = year + '-' +
        String(month + 1).padStart(2, '0') + '-' +
        String(d).padStart(2, '0') + 'T' +
        String(h).padStart(2, '0') + ':00:00';

      const slotObj = {
        date: d,
        text: `${formatTime(h)} - ${formatTime(h, 50)}`,
        iso: isoLocal,
        status: events.length === 0 ? 'free' : 'busy'
      };
      
      availableSlots.push(slotObj);
    }
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
  const subFolderName = `${safeName} - ${timestamp}`;
  const clientFolder = parentFolder.createFolder(subFolderName);

  const uploadedFiles = [];

  // 1. Create Text Document with Client Info
  let infoContent = 'CLIENT BOOKING DETAILS\n';
  infoContent += '======================\n\n';
  infoContent += `Name: ${data.name}\n`;
  infoContent += `Phone: ${data.phone}\n`;
  infoContent += `Email: ${data.email}\n`;
  infoContent += `Date Requested: ${data.dateStr}\n`;
  if(data.dob) infoContent += `DOB: ${data.dob}\n`;
  if(data.address) infoContent += `Address: ${data.address}\n`;
  infoContent += `\n----------------------\n`;
  infoContent += `NOTES:\n${data.notes || 'None'}\n`;
  infoContent += `----------------------\n\n`;
  infoContent += `Technical Info:\n`;
  infoContent += `IP: ${data.ip || 'Unknown'}\n`;
  infoContent += `User Agent: ${data.userInfo || 'Unknown'}\n`;
  infoContent += `Fingerprint: ${data.fingerprint || 'Unknown'}\n`;

  const textFile = clientFolder.createFile('Client_Info.txt', infoContent);
  // Make text file accessible via link too
  textFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
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
            driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            
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

  return { success: true };
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
    
    // Log structure: [Timestamp, Event Type, Description, IP Address, Device Info, Fingerprint]
    sheet.appendRow([
      timestamp,
      data.event || 'Generic Event',
      data.details || '',
      data.ip || 'Unknown',
      data.userInfo || '',
      data.fingerprint || ''
    ]);

    // Apply bold red formatting if suspicious
    if (data.suspicious) {
      const lastRow = sheet.getLastRow();
      const range = sheet.getRange(lastRow, 1, 1, 6); // Format first 6 columns
      range.setFontColor("#ff0000").setFontWeight("bold");
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
