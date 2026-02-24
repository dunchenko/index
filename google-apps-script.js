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

// BOOKING SECURITY CONFIGURATION
const TORONTO_TZ = 'America/Toronto';
const BOOKABLE_HOURS = [10, 12, 14, 16];
const SLOT_DURATION_MINUTES = 50;
const MIN_BOOKING_LEAD_DAYS = 2;

const NAME_MIN = 2;
const NAME_MAX = 80;
const OCCUPATION_MIN = 2;
const OCCUPATION_MAX = 100;
const EMAIL_MAX = 120;
const PHONE_MAX = 20;
const PHONE_DIGITS_MIN = 10;
const PHONE_DIGITS_MAX = 15;
const ADDRESS_MIN = 6;
const ADDRESS_MAX = 180;
const NOTES_MAX = 3000;
const DOB_MIN_YEAR = 1900;

const MAX_FILE_SIZE_BYTES = 99 * 1024 * 1024;   // 99 MB
const MAX_TOTAL_FILE_BYTES = 250 * 1024 * 1024; // 250 MB
const MAX_FILE_COUNT = 10;

const ALLOWED_SERVICES = [
  'Public Notary Services',
  'Employment Law',
  'Civil matter',
  'WSIB related issue',
  'LTB related issue',
  'Other'
];

const ALLOWED_FILE_MIME = {
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true
};

const ALLOWED_FILE_EXT = {
  jpg: true, jpeg: true, png: true, gif: true, webp: true, heic: true,
  pdf: true, doc: true, docx: true
};

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// Get the deployed web app URL
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function getDatabaseSheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${SHEET_GID}`;
}

function buildSheetRow(data, createdAt, fileLinks) {
  return [
    createdAt || '',
    data.dateStr || '',
    data.name || '',
    data.phone || '',
    data.email || '',
    data.service || '',
    '', // Keep legacy status column untouched
    data.dob || '',
    data.address || '',
    data.notes || '',
    fileLinks || ''
  ];
}

function appendClientToSheet(data, createdAt, fileLinks) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets().find(s => s.getSheetId().toString() === SHEET_GID) || ss.getSheets()[0];
    sheet.appendRow(buildSheetRow(data, createdAt, fileLinks));
    return { success: true, row: sheet.getLastRow() };
  } catch (e) {
    return { success: false, error: e.message };
  }
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
    let year = parseInt(e.parameter.year, 10);
    let month = parseInt(e.parameter.month, 10);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Invalid year/month.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
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
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Empty request body.');
    }

    const data = JSON.parse(e.postData.contents);
    if (data.action === 'log') {
      return ContentService.createTextOutput(JSON.stringify(logUsage(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (data.action === 'draft') {
      return ContentService.createTextOutput(JSON.stringify(logDraft(data)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Bot trap: hidden field must be empty.
    const honeypot = normalizeSingleLine(data._honeypot || data.website || '');
    if (honeypot) {
      try {
        logUsage({
          event: 'SUSPICIOUS: Honeypot Triggered',
          details: `Email: ${normalizeSingleLine(data.email || '')}`,
          userInfo: data.userInfo || '',
          fingerprint: data.fingerprint || ''
        });
      } catch (logErr) {}
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Invalid submission.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Bot trap: too-fast submission check.
    if (data._timestamp) {
      const ts = parseInt(String(data._timestamp), 10);
      if (!Number.isInteger(ts)) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Invalid timestamp.' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      const elapsed = Date.now() - ts;
      if (elapsed < 3000) {
        try {
          logUsage({
            event: 'SUSPICIOUS: Rapid Submission',
            details: `Elapsed: ${elapsed}ms`,
            userInfo: data.userInfo || '',
            fingerprint: data.fingerprint || ''
          });
        } catch (logErr) {}
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Submission too fast.' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    const normalized = validateAndNormalizeBookingPayload(data);
    const result = bookSlot(normalized);
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

function normalizeSingleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultiLine(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function truncate(value, maxLen) {
  return String(value || '').slice(0, maxLen);
}

function hasUnsafeChars(value) {
  return /[<>]/.test(String(value || ''));
}

function getFileExtension(fileName) {
  const cleanName = String(fileName || '');
  const dotIndex = cleanName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return cleanName.substring(dotIndex + 1).toLowerCase();
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || '')
    .replace(/[\\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(cleaned, 160);
}

function guessMimeByExt(ext) {
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isAllowedFileType(mime, ext) {
  const normalizedMime = String(mime || '').toLowerCase();
  if (normalizedMime.indexOf('image/') === 0) return true;
  if (ALLOWED_FILE_MIME[normalizedMime]) return true;
  if (ALLOWED_FILE_EXT[String(ext || '').toLowerCase()]) return true;
  return false;
}

function getTorontoNowDate() {
  const now = new Date();
  const y = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'yyyy'), 10);
  const m = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'M'), 10) - 1;
  const d = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'd'), 10);
  const hh = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'H'), 10);
  const mm = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'm'), 10);
  return getTorontoDate(y, m, d, hh, mm);
}

function getMinBookableTorontoDate() {
  const now = new Date();
  const y = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'yyyy'), 10);
  const m = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'M'), 10) - 1;
  const d = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'd'), 10);
  return getTorontoDate(y, m, d + MIN_BOOKING_LEAD_DAYS, 0, 0);
}

function parseAndValidateSlotDate(dateStr) {
  const raw = normalizeSingleLine(dateStr);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new Error('Invalid slot date format.');

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  const dateCheck = new Date(year, month, day);
  if (dateCheck.getFullYear() !== year || dateCheck.getMonth() !== month || dateCheck.getDate() !== day) {
    throw new Error('Invalid calendar date.');
  }
  if (minute !== 0) throw new Error('Invalid slot minute.');
  if (BOOKABLE_HOURS.indexOf(hour) === -1) throw new Error('Invalid slot hour.');

  const dayStartToronto = getTorontoDate(year, month, day, 0, 0);
  const dow = dayStartToronto.getDay();
  if (dow === 0 || dow === 6) throw new Error('Selected day is closed.');

  const slotStart = getTorontoDate(year, month, day, hour, minute);
  const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);
  const nowToronto = getTorontoNowDate();
  if (slotStart < nowToronto) throw new Error('Selected slot is in the past.');

  const minBookable = getMinBookableTorontoDate();
  if (dayStartToronto < minBookable) throw new Error('Selected day is not yet bookable.');

  return {
    normalized: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
    start: slotStart,
    end: slotEnd
  };
}

function parseAndValidateDob(dobRaw) {
  const dob = normalizeSingleLine(dobRaw);
  const match = dob.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) throw new Error('Invalid date of birth format.');

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const currentYear = parseInt(Utilities.formatDate(new Date(), TORONTO_TZ, 'yyyy'), 10);
  if (year < DOB_MIN_YEAR || year > currentYear) throw new Error('Invalid birth year.');
  if (month < 1 || month > 12) throw new Error('Invalid birth month.');
  if (day < 1 || day > 31) throw new Error('Invalid birth day.');

  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    throw new Error('Invalid date of birth.');
  }

  const now = new Date();
  const nowYear = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'yyyy'), 10);
  const nowMonth = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'M'), 10);
  const nowDay = parseInt(Utilities.formatDate(now, TORONTO_TZ, 'd'), 10);
  let age = nowYear - year;
  if (nowMonth < month || (nowMonth === month && nowDay < day)) age--;
  if (age < 18) throw new Error('Client must be at least 18 years old.');

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function validateAndNormalizeFiles(filesRaw) {
  if (filesRaw == null) return [];
  if (!Array.isArray(filesRaw)) throw new Error('Invalid files payload.');
  if (filesRaw.length > MAX_FILE_COUNT) throw new Error(`Too many files (max ${MAX_FILE_COUNT}).`);

  const normalizedFiles = [];
  let totalSize = 0;

  filesRaw.forEach((file, idx) => {
    if (!file || typeof file !== 'object') throw new Error(`Invalid file entry #${idx + 1}.`);

    const safeName = sanitizeFileName(file.name || `file-${idx + 1}`);
    const ext = getFileExtension(safeName);
    const mime = normalizeSingleLine(file.type || '').toLowerCase() || guessMimeByExt(ext);
    if (!isAllowedFileType(mime, ext)) throw new Error(`Unsupported file type: ${safeName}`);

    const b64 = String(file.data || '').replace(/\s+/g, '');
    if (!b64) throw new Error(`Empty file payload: ${safeName}`);
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error(`Invalid base64 payload: ${safeName}`);

    const approxBytes = Math.floor((b64.length * 3) / 4);
    if (approxBytes > MAX_FILE_SIZE_BYTES) throw new Error(`File too large: ${safeName}`);

    const bytes = Utilities.base64Decode(b64);
    if (bytes.length > MAX_FILE_SIZE_BYTES) throw new Error(`File too large: ${safeName}`);

    totalSize += bytes.length;
    if (totalSize > MAX_TOTAL_FILE_BYTES) throw new Error('Total upload size exceeds limit.');

    normalizedFiles.push({
      name: safeName,
      type: mime,
      bytes: bytes,
      sizeBytes: bytes.length
    });
  });

  return normalizedFiles;
}

function validateAndNormalizeBookingPayload(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid payload.');

  const normalized = {
    name: normalizeSingleLine(raw.name),
    occupation: normalizeSingleLine(raw.occupation),
    email: normalizeSingleLine(raw.email).toLowerCase(),
    phone: normalizeSingleLine(raw.phone),
    service: normalizeSingleLine(raw.service),
    notes: normalizeMultiLine(raw.notes),
    address: normalizeSingleLine(raw.address),
    userInfo: truncate(normalizeSingleLine(raw.userInfo), 1000),
    fingerprint: truncate(normalizeSingleLine(raw.fingerprint), 256)
  };

  if (normalized.name.length < NAME_MIN || normalized.name.length > NAME_MAX || hasUnsafeChars(normalized.name)) {
    throw new Error('Invalid name.');
  }
  if (normalized.occupation.length < OCCUPATION_MIN || normalized.occupation.length > OCCUPATION_MAX || hasUnsafeChars(normalized.occupation)) {
    throw new Error('Invalid occupation.');
  }
  if (normalized.email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalized.email)) {
    throw new Error('Invalid email.');
  }

  const phoneDigits = normalized.phone.replace(/\D/g, '');
  if (
    normalized.phone.length > PHONE_MAX ||
    !/^[+\d().\-\s]+$/.test(normalized.phone) ||
    phoneDigits.length < PHONE_DIGITS_MIN ||
    phoneDigits.length > PHONE_DIGITS_MAX
  ) {
    throw new Error('Invalid phone.');
  }

  if (ALLOWED_SERVICES.indexOf(normalized.service) === -1) {
    throw new Error('Invalid service.');
  }

  if (normalized.address.length < ADDRESS_MIN || normalized.address.length > ADDRESS_MAX || hasUnsafeChars(normalized.address)) {
    throw new Error('Invalid address.');
  }

  if (normalized.notes.length > NOTES_MAX || hasUnsafeChars(normalized.notes)) {
    throw new Error('Invalid notes.');
  }

  normalized.dob = parseAndValidateDob(raw.dob);
  const slot = parseAndValidateSlotDate(raw.dateStr);
  normalized.dateStr = slot.normalized;
  normalized.slotStart = slot.start;
  normalized.slotEnd = slot.end;

  normalized.files = validateAndNormalizeFiles(raw.files);
  return normalized;
}

function isBlockingEvent(event) {
  const title = String(event.getTitle() || '').toLowerCase();
  return !title.includes('appointment') && !title.includes('schedule');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdown(value) {
  return String(value || '').replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function encodeUriValue(value) {
  return encodeURIComponent(String(value || ''));
}

function normalizePhoneInternational(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return '+' + digits;
}

function buildTelLink(phone) {
  const intl = normalizePhoneInternational(phone);
  return intl ? `tel:${intl}` : '';
}

function buildSmsLink(phone, body) {
  const intl = normalizePhoneInternational(phone);
  return intl ? `sms:${intl}?body=${encodeUriValue(body || '')}` : '';
}

function buildWhatsAppLink(phone, text) {
  const intl = normalizePhoneInternational(phone).replace('+', '');
  return intl ? `https://wa.me/${intl}?text=${encodeUriValue(text || '')}` : '';
}

function buildMailtoLink(email, subject, body) {
  const cleanEmail = normalizeSingleLine(email || '');
  if (!cleanEmail) return '';
  return `mailto:${cleanEmail}?subject=${encodeUriValue(subject || '')}&body=${encodeUriValue(body || '')}`;
}

function buildMapsSearchLink(address) {
  const clean = normalizeSingleLine(address || '');
  return clean ? `https://www.google.com/maps/search/?api=1&query=${encodeUriValue(clean)}` : '';
}

function buildMapsDirectionsLink(address) {
  const clean = normalizeSingleLine(address || '');
  return clean ? `https://www.google.com/maps/dir/?api=1&destination=${encodeUriValue(clean)}&travelmode=driving` : '';
}

function buildGoogleSearchLink(query) {
  const clean = normalizeSingleLine(query || '');
  return clean ? `https://www.google.com/search?q=${encodeUriValue(clean)}` : '';
}

function buildGmailSearchLink(query) {
  const clean = normalizeSingleLine(query || '');
  return clean ? `https://mail.google.com/mail/u/0/#search/${encodeUriValue(clean)}` : '';
}

function buildDriveSearchLink(query) {
  const clean = normalizeSingleLine(query || '');
  return clean ? `https://drive.google.com/drive/search?q=${encodeUriValue(clean)}` : '';
}

function buildCalendarDayLink(startDate) {
  if (!(startDate instanceof Date)) return 'https://calendar.google.com/calendar/u/0/r';
  const dayPath = Utilities.formatDate(startDate, TORONTO_TZ, 'yyyy/MM/dd');
  return `https://calendar.google.com/calendar/u/0/r/day/${dayPath}`;
}

function buildCalendarSearchLink(query) {
  const clean = normalizeSingleLine(query || '');
  return clean ? `https://calendar.google.com/calendar/u/0/r/search/${encodeUriValue(clean)}` : 'https://calendar.google.com/calendar/u/0/r';
}

function toUtcCalendarStamp(dateObj) {
  return Utilities.formatDate(dateObj, 'Etc/UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function buildCalendarTemplateLink(data) {
  const start = data && data.slotStart instanceof Date ? data.slotStart : null;
  const end = data && data.slotEnd instanceof Date ? data.slotEnd : null;
  if (!start || !end) return '';

  const title = `Follow-up: ${normalizeSingleLine(data.name || 'Client')}`;
  const details = [
    `Client: ${normalizeSingleLine(data.name || '')}`,
    `Service: ${normalizeSingleLine(data.service || '')}`,
    `Phone: ${normalizeSingleLine(data.phone || '')}`,
    `Email: ${normalizeSingleLine(data.email || '')}`,
    `Original slot: ${normalizeSingleLine(data.dateStr || '')}`
  ].join('\n');
  const location = normalizeSingleLine(data.address || '');

  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeUriValue(title)}`
    + `&dates=${encodeUriValue(toUtcCalendarStamp(start) + '/' + toUtcCalendarStamp(end))}`
    + `&details=${encodeUriValue(details)}`
    + `&location=${encodeUriValue(location)}`;
}

function getDatabaseRowUrl(row) {
  if (!row) return getDatabaseSheetUrl();
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${SHEET_GID}&range=A${row}`;
}

function getFreeSlots(year, month) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const endDate = new Date(year, month + 1, 0);
  const startHours = BOOKABLE_HOURS;
  const availableSlots = [];
  const now = getTorontoNowDate();
  const minBookable = getMinBookableTorontoDate();
  for (let d = 1; d <= endDate.getDate(); d++) {
    const checkDate = getTorontoDate(year, month, d, 0, 0);
    if (checkDate < minBookable) continue;
    if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;
    startHours.forEach(h => {
      const slotStart = getTorontoDate(year, month, d, h, 0);
      const slotEnd = getTorontoDate(year, month, d, h, SLOT_DURATION_MINUTES);
      if (slotStart < now) return;
      const events = calendar.getEvents(slotStart, slotEnd).filter(isBlockingEvent);
      availableSlots.push({
        date: d,
        text: `${formatTime(h, 0)} - ${formatTime(h, SLOT_DURATION_MINUTES)}`,
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
  const timestamp = Utilities.formatDate(new Date(), TORONTO_TZ, 'yyyy-MM-dd_HH-mm-ss');
  const safeName = sanitizeFileName(data.name || 'Client').replace(/\./g, '_');
  const clientFolder = parentFolder.createFolder(`${timestamp} - ${safeName}`);
  const uploadedFiles = [];

  let info = 'CLIENT BOOKING DETAILS\n======================\n\n';
  info += `Name: ${data.name}\n`;
  info += `Occupation: ${data.occupation || 'N/A'}\n`;
  info += `Phone: ${data.phone}\n`;
  info += `Email: ${data.email}\n`;
  info += `Date: ${data.dateStr}\n`;
  if (data.service) info += `Service: ${data.service}\n`;
  if (data.dob) info += `DOB: ${data.dob}\n`;
  if (data.address) info += `Address: ${data.address}\n`;
  info += `\nNOTES:\n${data.notes || 'None'}\n\nTechnical:\nUA: ${data.userInfo || 'N/A'}\nFingerprint: ${data.fingerprint || 'N/A'}`;

  const textFile = clientFolder.createFile('Client_Info.txt', info);
  uploadedFiles.push({ name: 'Client_Info.txt', url: textFile.getUrl() });

  if (data.files && Array.isArray(data.files)) {
    data.files.forEach(file => {
      try {
        if (!file || !file.bytes || !file.bytes.length) return;
        const fileName = sanitizeFileName(file.name || 'attachment');
        const ext = getFileExtension(fileName);
        const fileType = normalizeSingleLine(file.type || '').toLowerCase() || guessMimeByExt(ext);
        const driveFile = clientFolder.createFile(Utilities.newBlob(file.bytes, fileType, fileName));
        uploadedFiles.push({ name: fileName, url: driveFile.getUrl() });
      } catch (e) {}
    });
  }
  return uploadedFiles;
}

function bookSlot(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, error: 'SLOT_TAKEN' };
  }

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  try {
    const startTime = data.slotStart instanceof Date ? data.slotStart : null;
    const endTime = data.slotEnd instanceof Date ? data.slotEnd : null;
    if (!startTime || !endTime) {
      throw new Error('Invalid slot payload.');
    }

    const conflicts = calendar.getEvents(startTime, endTime).filter(isBlockingEvent);
    if (conflicts.length > 0) {
      return { success: false, error: 'SLOT_TAKEN' };
    }

    const uploadedFiles = saveClientDataAndFiles(data);
    const fileLinks = uploadedFiles.map(f => `${f.name}: ${f.url}`).join('\n');
    const createdAt = Utilities.formatDate(new Date(), TORONTO_TZ, 'yyyy-MM-dd HH:mm');
    const dbSheetUrl = getDatabaseSheetUrl();
    const sheetWrite = appendClientToSheet(data, createdAt, fileLinks);

    let desc = `Client: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email}\nService: ${data.service}\n`;
    if (data.notes) desc += `Notes: ${data.notes}\n`;
    if (uploadedFiles.length > 0) desc += `\nFiles:\n${fileLinks}\n`;
    desc += `\nDatabase status: ${sheetWrite.success ? `Added (row ${sheetWrite.row})` : `FAILED (${sheetWrite.error || 'unknown'})`}`;
    desc += `\nDatabase sheet:\n${dbSheetUrl}`;

    calendar.createEvent(`Consultation: ${data.name}`, startTime, endTime, { description: desc });

    try { sendIntakeEmail(data, dbSheetUrl, uploadedFiles, sheetWrite); } catch (e) {}
    try {
      sendTelegram(data, uploadedFiles, dbSheetUrl, sheetWrite);
    } catch (e) {
      try {
        logUsage({
          event: 'TELEGRAM ERROR',
          details: truncate(String(e && e.message ? e.message : e), 1000),
          userInfo: data.userInfo || '',
          fingerprint: data.fingerprint || ''
        });
      } catch (logErr) {}
    }

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function sendTelegram(data, uploadedFiles, databaseSheetUrl, sheetWrite) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    throw new Error('Telegram config missing: TG_TOKEN or TG_CHAT_ID is empty.');
  }

  function sendTelegramChunk(text) {
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text,
        disable_web_page_preview: true
      })
    });

    const status = response.getResponseCode();
    const body = String(response.getContentText() || '');
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (e) {}

    if (status < 200 || status >= 300 || !parsed || parsed.ok !== true) {
      const apiDescription = parsed && parsed.description ? parsed.description : 'No description';
      throw new Error(`Telegram send failed. HTTP ${status}. ${apiDescription}`);
    }
  }

  const dbUrl = normalizeSingleLine(databaseSheetUrl || getDatabaseSheetUrl());
  const rowUrl = sheetWrite && sheetWrite.success && sheetWrite.row ? getDatabaseRowUrl(sheetWrite.row) : '';
  const fileLines = [];
  if (uploadedFiles && uploadedFiles.length) {
    uploadedFiles.forEach((f, idx) => {
      if (!f) return;
      const name = truncate(normalizeSingleLine(f.name || `file-${idx + 1}`), 120);
      const url = normalizeSingleLine(f.url || '');
      if (url) {
        fileLines.push(`${idx + 1}. ${name}: ${url}`);
      } else {
        fileLines.push(`${idx + 1}. ${name}`);
      }
    });
  } else {
    fileLines.push('None');
  }

  const lines = [
    'NEW LEAD',
    `Name: ${normalizeSingleLine(data.name)}`,
    `Occupation: ${normalizeSingleLine(data.occupation || '')}`,
    `Email: ${normalizeSingleLine(data.email)}`,
    `Phone: ${normalizeSingleLine(data.phone)}`,
    `Service: ${normalizeSingleLine(data.service)}`,
    `DOB: ${normalizeSingleLine(data.dob || '')}`,
    `Address: ${normalizeSingleLine(data.address || '')}`,
    `Appointment: ${normalizeSingleLine(data.dateStr || '')}`,
    `Database sheet: ${dbUrl}`,
    rowUrl ? `Database row: ${rowUrl}` : '',
    '',
    'Brief:',
    normalizeMultiLine(data.notes || 'None'),
    '',
    'Files:',
    fileLines.join('\n')
  ].filter(Boolean);

  const maxChunkLen = 3500;
  const chunks = [];
  let current = '';
  lines.forEach(line => {
    const part = String(line || '');
    const candidate = current ? `${current}\n${part}` : part;
    if (candidate.length <= maxChunkLen) {
      current = candidate;
      return;
    }
    if (current) {
      chunks.push(current);
      current = '';
    }
    if (part.length <= maxChunkLen) {
      current = part;
      return;
    }
    // Hard split very long lines (for example very long notes)
    for (let i = 0; i < part.length; i += maxChunkLen) {
      const segment = part.slice(i, i + maxChunkLen);
      if (segment) chunks.push(segment);
    }
  });
  if (current) chunks.push(current);
  if (!chunks.length) chunks.push('NEW LEAD');

  chunks.forEach((chunk, idx) => {
    const header = chunks.length > 1 ? `Part ${idx + 1}/${chunks.length}\n` : '';
    sendTelegramChunk(header + chunk);
  });

  return { success: true, parts: chunks.length };
}

function sendIntakeEmail(data, databaseSheetUrl, uploadedFiles, sheetWrite) {
  const recipient = 'paralegal@hannadunchenko.com';
  const subject = `New Intake Request: ${normalizeSingleLine(data.name)}`;
  const safeName = escapeHtml(data.name);
  const safeOccupation = escapeHtml(data.occupation || 'N/A');
  const safeEmail = escapeHtml(data.email);
  const safePhone = escapeHtml(data.phone);
  const safeService = escapeHtml(data.service);
  const safeDob = escapeHtml(data.dob || 'N/A');
  const safeAddress = escapeHtml(data.address || 'N/A');
  const safeNotes = escapeHtml(data.notes || 'None');
  const dbUrl = databaseSheetUrl || getDatabaseSheetUrl();

  const dbStatusText = sheetWrite && sheetWrite.success
    ? `Added automatically to database (row ${sheetWrite.row}).`
    : `Auto-add failed: ${(sheetWrite && sheetWrite.error) ? sheetWrite.error : 'Unknown error'}`;
  const safeDbStatus = escapeHtml(dbStatusText);

  const fileHtml = uploadedFiles && uploadedFiles.length
    ? uploadedFiles
        .map(f => `<li style="margin:0 0 8px 0;"><a href="${escapeHtml(f.url)}" style="color:#5a3d2a;text-decoration:none;font-weight:700;">${escapeHtml(f.name)}</a></li>`)
    .join('')
    : '<li style="margin:0;">No attachments</li>';

  const followupSubject = `Re: Intake request - ${normalizeSingleLine(data.name)}`;
  const followupBody = [
    `Hello ${normalizeSingleLine(data.name)},`,
    '',
    'Thank you for your intake request.',
    'We reviewed your details and will follow up shortly.',
    '',
    'Kind regards,',
    'Hanna Dunchenko'
  ].join('\n');

  const actions = [];
  function addAction(label, url, tone) {
    if (!url) return;
    actions.push({ label: label, url: url, tone: tone || 'secondary' });
  }

  addAction('Open Client Database', dbUrl, 'primary');
  addAction('Open Spreadsheet Home', getDatabaseSheetUrl(), 'primary');
  if (sheetWrite && sheetWrite.success && sheetWrite.row) {
    addAction(`Go To Row ${sheetWrite.row}`, getDatabaseRowUrl(sheetWrite.row), 'primary');
  }

  addAction('Open Calendar Day', buildCalendarDayLink(data.slotStart));
  addAction('Create Follow-up Event', buildCalendarTemplateLink(data));
  addAction('Search In Calendar', buildCalendarSearchLink(`${data.name} ${data.email || ''}`));

  addAction('Reply By Email', buildMailtoLink(data.email, followupSubject, followupBody));
  addAction('New Email Draft', buildMailtoLink(data.email, `Consultation update - ${normalizeSingleLine(data.name)}`, followupBody));
  addAction('Internal Note Email', buildMailtoLink(recipient, `Internal note: ${normalizeSingleLine(data.name)}`, `Client: ${normalizeSingleLine(data.name)}\nPhone: ${normalizeSingleLine(data.phone)}\nEmail: ${normalizeSingleLine(data.email)}\nService: ${normalizeSingleLine(data.service)}\n`));

  addAction('Call Client', buildTelLink(data.phone));
  addAction('Send SMS', buildSmsLink(data.phone, `Hello ${normalizeSingleLine(data.name)}, this is Hanna Dunchenko regarding your intake request.`));
  addAction('Open WhatsApp', buildWhatsAppLink(data.phone, `Hello ${normalizeSingleLine(data.name)}, this is Hanna Dunchenko regarding your intake request.`));

  addAction('Open Address In Maps', buildMapsSearchLink(data.address));
  addAction('Get Driving Directions', buildMapsDirectionsLink(data.address));

  addAction('Search Client In Gmail', buildGmailSearchLink(`${normalizeSingleLine(data.email)} OR ${normalizeSingleLine(data.phone)}`));
  addAction('Search Client Files', buildDriveSearchLink(`${normalizeSingleLine(data.name)} ${normalizeSingleLine(data.email)}`));
  addAction('Google Client Search', buildGoogleSearchLink(`${normalizeSingleLine(data.name)} ${normalizeSingleLine(data.phone)} ${normalizeSingleLine(data.email)}`));
  addAction('Open Google Contacts', `https://contacts.google.com/search/${encodeUriValue(data.email || data.phone || data.name || '')}`);
  addAction('Open Google Meet', 'https://meet.google.com/new');
  addAction('Open Telegram Web', 'https://web.telegram.org/');
  addAction('Open Logs Sheet', `https://docs.google.com/spreadsheets/d/${LOG_SPREADSHEET_ID}/edit`);

  if (uploadedFiles && uploadedFiles.length && uploadedFiles[0] && uploadedFiles[0].url) {
    addAction('Open First Attachment', uploadedFiles[0].url);
  }

  const primaryBtnStyle = 'display:inline-block;margin:0 8px 10px 0;padding:10px 14px;border-radius:10px;background:#5a3d2a;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;line-height:1.2;';
  const secondaryBtnStyle = 'display:inline-block;margin:0 8px 10px 0;padding:10px 14px;border-radius:10px;background:#f4ece4;color:#5a3d2a;text-decoration:none;font-weight:700;font-size:13px;line-height:1.2;border:1px solid #dbc8b6;';
  const actionsHtml = actions
    .map(a => `<a href="${escapeHtml(a.url)}" target="_blank" style="${a.tone === 'primary' ? primaryBtnStyle : secondaryBtnStyle}">${escapeHtml(a.label)}</a>`)
    .join('');

  const htmlBody = `
<div style="margin:0;padding:24px;background:#efe3d6;background:linear-gradient(180deg,#f4e9dd 0%,#eadaca 100%);font-family:Arial,sans-serif;color:#3f2f22;">
  <div style="max-width:760px;margin:0 auto;background:#fffaf5;border:1px solid #d8c1aa;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(90,61,42,0.16);">
    <div style="padding:24px 28px;background:linear-gradient(135deg,#7a5a44 0%,#5a3d2a 100%);color:#fff;">
      <div style="font-size:13px;letter-spacing:1.2px;text-transform:uppercase;opacity:0.9;">Hanna Dunchenko - Intake Notification</div>
      <h2 style="margin:10px 0 0 0;font-size:24px;line-height:1.2;">New Consultation Request</h2>
    </div>

    <div style="padding:24px 28px;">
      <div style="padding:14px 16px;border-radius:12px;background:#f4ece4;border:1px solid #dfccba;margin-bottom:18px;">
        <strong style="display:block;margin-bottom:6px;color:#5a3d2a;">Database status</strong>
        <span style="font-size:14px;color:#4a3829;">${safeDbStatus}</span>
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.45;">
        <tr><td style="padding:8px 0;color:#8b6f5a;width:190px;">Name</td><td style="padding:8px 0;color:#2f241b;font-weight:700;">${safeName}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">Occupation</td><td style="padding:8px 0;color:#2f241b;">${safeOccupation}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">Email</td><td style="padding:8px 0;color:#2f241b;">${safeEmail}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">Phone</td><td style="padding:8px 0;color:#2f241b;">${safePhone}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">Service</td><td style="padding:8px 0;color:#2f241b;">${safeService}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">DOB</td><td style="padding:8px 0;color:#2f241b;">${safeDob}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">Address</td><td style="padding:8px 0;color:#2f241b;">${safeAddress}</td></tr>
        <tr><td style="padding:8px 0;color:#8b6f5a;">Appointment</td><td style="padding:8px 0;color:#2f241b;font-weight:700;">${escapeHtml(data.dateStr)}</td></tr>
      </table>

      <div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:#fff;border:1px solid #e8d9ca;">
        <strong style="display:block;margin-bottom:8px;color:#5a3d2a;">Brief / Notes</strong>
        <div style="white-space:pre-wrap;color:#3b2c1f;font-size:14px;line-height:1.5;">${safeNotes}</div>
      </div>

      <div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:#fff;border:1px solid #e8d9ca;">
        <strong style="display:block;margin-bottom:8px;color:#5a3d2a;">Attached files</strong>
        <ul style="margin:0;padding-left:18px;color:#3b2c1f;font-size:14px;line-height:1.45;">${fileHtml}</ul>
      </div>

      <div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:#fff;border:1px solid #e8d9ca;">
        <strong style="display:block;margin-bottom:10px;color:#5a3d2a;">Quick actions (${actions.length})</strong>
        <div style="line-height:1.4;">${actionsHtml}</div>
      </div>
    </div>
  </div>
</div>`;

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    htmlBody: htmlBody
  });
}

function addClientToSheet(p) {
  try {
    const payload = {
      name: normalizeSingleLine(p.n || ''),
      phone: normalizeSingleLine(p.ph || ''),
      email: normalizeSingleLine(p.e || ''),
      service: normalizeSingleLine(p.srv || ''),
      dob: normalizeSingleLine(p.d || ''),
      address: normalizeSingleLine(p.adr || ''),
      notes: normalizeMultiLine(p.nt || ''),
      dateStr: normalizeSingleLine(p.dt || '')
    };
    const createdAt = normalizeSingleLine(p.c || Utilities.formatDate(new Date(), TORONTO_TZ, 'yyyy-MM-dd HH:mm'));
    const fileLinks = String(p.f || '');

    const write = appendClientToSheet(payload, createdAt, fileLinks);
    const dbUrl = getDatabaseSheetUrl();
    if (!write.success) {
      return HtmlService.createHtmlOutput(`
        <html><body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f4e9dd;color:#3f2f22;">
          <div style="max-width:680px;margin:40px auto;background:#fffaf5;border:1px solid #d8c1aa;border-radius:14px;padding:22px;">
            <h2 style="margin:0 0 12px 0;color:#5a3d2a;">Database Error</h2>
            <p style="margin:0 0 16px 0;">${escapeHtml(write.error || 'Unknown error')}</p>
            <a href="${escapeHtml(dbUrl)}" style="display:inline-block;padding:10px 16px;background:#5a3d2a;color:#fff;text-decoration:none;border-radius:8px;">Open Spreadsheet</a>
          </div>
        </body></html>
      `);
    }

    return HtmlService.createHtmlOutput(`
      <html><body style="margin:0;padding:20px;font-family:Arial,sans-serif;background:#f4e9dd;color:#3f2f22;">
        <div style="max-width:680px;margin:40px auto;background:#fffaf5;border:1px solid #d8c1aa;border-radius:14px;padding:22px;">
          <h2 style="margin:0 0 12px 0;color:#5a3d2a;">Client Added</h2>
          <p style="margin:0 0 8px 0;">Row: <strong>${write.row}</strong></p>
          <p style="margin:0 0 16px 0;">The client was added to the spreadsheet.</p>
          <a href="${escapeHtml(dbUrl)}" style="display:inline-block;padding:10px 16px;background:#5a3d2a;color:#fff;text-decoration:none;border-radius:8px;">Open Spreadsheet</a>
        </div>
      </body></html>
    `);
  } catch (e) {
    return HtmlService.createHtmlOutput('Error: ' + escapeHtml(e.message));
  }
}

function formatTime(h, m) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hours = String(h % 12 || 12).padStart(2, '0');
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



