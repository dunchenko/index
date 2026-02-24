/* 
  MASTER CONFIGURATION 
*/
const CALENDAR_ID = 'primary'; 
const DRIVE_FOLDER_NAME = 'Client Bookings';
const SPREADSHEET_ID = '1R81HIyxwHuAyvlBBQ8KHUVPa6N7pZnWiDDcLOe5qUrE';
const SHEET_GID = '0';

// LOGGING CONFIGURATION
const LOG_SPREADSHEET_ID = '1Q2-FH5SA7ESvHawriZF3DMbI_8wrIyuGWMsZ2tb9QxQ';
const LOG_SHEET_NAME = 'Sheet1'; 

// TELEGRAM CONFIGURATION
const TG_TOKEN = '8448746916:AAHHJNuXubpjFfMsIDV08OcP8DyXlpQA9RE';
const TG_CHAT_ID = '1342838996'; 

// Get the deployed web app URL
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function doGet(e) {
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("Error: No parameters provided.")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  const action = e.parameter.action;
  if (action === 'addToSheet' || e.parameter.act === 'addToSheet') {
    return addClientToSheet(e.parameter);
  }
    let year = parseInt(e.parameter.year);
    let month = parseInt(e.parameter.month);
    
    let result = { success: false, slots: [], resultYear: year, resultMonth: month };
    let monthsSearched = 0;
    const MAX_MONTHS = 6;

    while (monthsSearched < MAX_MONTHS) {
      const availability = getFreeSlots(year, month);
      const hasFreeWeekday = availability.slots.some(s => {
        const d = new Date(year, month, s.date);
        return d.getDay() !== 0 && d.getDay() !== 6 && s.status === 'free';
      });

      if (hasFreeWeekday || monthsSearched === MAX_MONTHS - 1) {
        result = { 
          success: true, 
          slots: availability.slots, 
          resultYear: year, 
          resultMonth: month 
        };
        break;
      }

      // Move to next month
      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
      monthsSearched++;
    }

    return ContentService.createTextOutput(
      JSON.stringify(result)
    ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'log') {
      return ContentService.createTextOutput(JSON.stringify(logUsage(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (data.action === 'draft') {
      return ContentService.createTextOutput(JSON.stringify(logDraft(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const result = bookSlot(data);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getTorontoDate(year, month, day, hour, minute) {
  const date = new Date(year, month, day, hour || 0, minute || 0);
  const offset = Utilities.formatDate(date, 'America/Toronto', 'Z');
  const formattedOffset = offset.slice(0, 3) + ":" + offset.slice(3);
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
    if (checkDate.getDay() === 0) continue; 
    startHours.forEach(h => {
      const slotStart = getTorontoDate(year, month, d, h, 0);
      const slotEnd = getTorontoDate(year, month, d, h, 50);
      if (slotStart < now) return; 
      const events = calendar.getEvents(slotStart, slotEnd).filter(e => {
        const title = e.getTitle().toLowerCase();
        return !title.includes('appointment') && !title.includes('schedule');
      });
      availableSlots.push({
        date: d,
        text: `${formatTime(h, 0)} – ${formatTime(h, 50)}`,
        iso: year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':00:00',
        status: events.length === 0 ? 'free' : 'busy'
      });
    });
  }
  return { success: true, slots: availableSlots };
}

function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
}

function saveClientDataAndFiles(data) {
  const parentFolder = getOrCreateFolder(DRIVE_FOLDER_NAME);
  const timestamp = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd_HH-mm-ss');
  const safeName = (data.name || 'Client').replace(/[^a-zA-Z0-9 ]/g, "").trim();
  const clientFolder = parentFolder.createFolder(`${timestamp} - ${safeName}`);
  const uploadedFiles = [];
  
  let info = 'CLIENT BOOKING DETAILS\n======================\n\n';
  info += `Name: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email}\nDate: ${data.dateStr}\n`;
  if(data.service) info += `Service: ${data.service}\n`;
  if(data.dob) info += `DOB: ${data.dob}\n`;
  if(data.address) info += `Address: ${data.address}\n`;
  info += `\nNOTES:\n${data.notes || 'None'}\n\nTechnical:\nUA: ${data.userInfo || 'N/A'}`;
  
  const textFile = clientFolder.createFile('Client_Info.txt', info);
  uploadedFiles.push({ name: 'Client_Info.txt', url: textFile.getUrl() });

  if (data.files && Array.isArray(data.files)) {
    data.files.forEach(file => {
      try {
        const decoded = Utilities.base64Decode(file.data);
        const driveFile = clientFolder.createFile(Utilities.newBlob(decoded, file.type, file.name));
        uploadedFiles.push({ name: file.name, url: driveFile.getUrl() });
      } catch(e) {}
    });
  }
  return uploadedFiles;
}

function bookSlot(data) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const parts = data.dateStr.split(/[-T:]/);
  const startTime = getTorontoDate(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), parseInt(parts[3]), parseInt(parts[4]));
  const endTime = new Date(startTime.getTime() + (50 * 60 * 1000));
  const uploadedFiles = saveClientDataAndFiles(data);
  const scriptUrl = getScriptUrl();
  const fileLinks = uploadedFiles.map(f => `${f.name}: ${f.url}`).join('\n');
  
  const sheetParams = {
    act: 'addToSheet', n: data.name, ph: data.phone, e: data.email, srv: data.service, 
    d: data.dob, adr: data.address, nt: data.notes, dt: data.dateStr, 
    c: Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm'), f: fileLinks
  };
  const queryString = Object.keys(sheetParams).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(sheetParams[k])).join('&');
  const addToSheetLink = scriptUrl + '?' + queryString;

  let desc = `Client: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email}\nService: ${data.service}\n`;
  if(data.notes) desc += `Notes: ${data.notes}\n`;
  if(uploadedFiles.length > 0) desc += `\nFiles:\n${fileLinks}\n`;
  desc += `\n📋 ADD TO DATABASE:\n${addToSheetLink}`;

  calendar.createEvent(`Consultation: ${data.name}`, startTime, endTime, { description: desc });

  // EXECUTE EMAILS AND TELEGRAM
  try { sendIntakeEmail(data, addToSheetLink, uploadedFiles); } catch(e) {}
  try { sendTelegram(data); } catch(e) {}

  return { success: true };
}

function sendTelegram(data) {
  const msg = `🎯 *NEW LEAD!*\n👤 *Name:* ${data.name}\n📧 *Email:* ${data.email}\n📞 *Phone:* ${data.phone}\n💼 *Service:* ${data.service}\n📅 *Date:* ${data.dateStr}`;
  UrlFetchApp.fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: "Markdown" })
  });
}

function sendIntakeEmail(data, addToSheetLink, uploadedFiles) {
  const recipient = "paralegal@hannadunchenko.com";
  const subject = `New Intake Request: ${data.name}`;
  let fileHtml = uploadedFiles.map(f => `<li><a href="${f.url}">${f.name}</a></li>`).join('');
  
  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; color: #333;">
      <h2 style="color: #6B5B4A;">New Consultation Request</h2>
      <p><strong>Name:</strong> ${data.name}</p>
      <p><strong>Email:</strong> ${data.email}</p>
      <p><strong>Phone:</strong> ${data.phone}</p>
      <p><strong>Service:</strong> ${data.service}</p>
      <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
      <h3>Attached Files:</h3>
      <ul>${fileHtml}</ul>
      <hr>
      <a href="${addToSheetLink}" style="display:inline-block; padding:10px 20px; background:#6B5B4A; color:#fff; text-decoration:none; border-radius:5px;">Add Client to Database</a>
    </div>
  `;
  
  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody
  });
}

function addClientToSheet(p) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets().find(s => s.getSheetId().toString() === SHEET_GID) || ss.getSheets()[0];
    sheet.appendRow([p.c||'', p.dt||'', p.n||'', p.ph||'', p.e||'', p.srv||'', '', p.d||'', p.adr||'', p.nt||'', p.f||'']);
    return HtmlService.createHtmlOutput('<html><body style="background:#1a1a1a;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;"><h2>✅ Added</h2><script>setTimeout(window.close,1500)</script></body></html>');
  } catch(e) { return HtmlService.createHtmlOutput('Error: ' + e.message); }
}

function formatTime(h, m) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hours = h % 12 || 12;
  return `${hours}:${String(m).padStart(2, '0')} ${ampm}`;
}

function logUsage(d) {
  try {
    const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(LOG_SHEET_NAME) || ss.getSheets()[0];
    sheet.appendRow([Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm:ss'), d.event, d.details, '', d.userInfo, d.fingerprint]);
    return { success: true };
  } catch(e) { return { success: false }; }
}

function logDraft(d) {
  return logUsage({ event: 'DRAFT', details: `Name: ${d.name} | Note: ${d.notes}`, userInfo: d.userInfo, fingerprint: d.fingerprint });
}
