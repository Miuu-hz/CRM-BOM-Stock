import Papa from 'papaparse';

// ponytail: XLS/XLSX is out of scope for HR Phase 3a.
// The frontend can convert Excel to CSV before uploading, or an xlsx parser can be added later if raw upload is required.

export interface Punch {
  devicePin: string;
  at: string; /* 'YYYY-MM-DD HH:mm:ss' local Thai time, no timezone conversion */
}

export interface ParseAttendanceResult {
  punches: Punch[];
  skipped: { line: number; reason: string }[];
}

export interface Shift {
  start: string; /* 'HH:mm' */
  end: string;   /* 'HH:mm' */
  graceMinutes: number;
  breakMinutes: number;
}

export interface DaySummary {
  workDate: string;
  in?: string;
  out?: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  otCandidateMinutes: number;
  missingOut: boolean;
  absent: boolean;
}

export interface PeriodTotals {
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otCandidateMinutes: number;
  absentDays: number;
  daysWorked: number;
  leaveDays?: number;
  holidayDays?: number;
}

export interface EmployeePeriodSummary {
  days: DaySummary[];
  totals: PeriodTotals;
}

export interface PeriodSummary {
  byPin: Record<string, EmployeePeriodSummary>;
  unmapped: string[];
}

/**
 * แปลงสตริงวันที่ให้อยู่ในรูปแบบ 'YYYY-MM-DD'
 * รองรับ YYYY-MM-DD, DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY และ พ.ศ. (> 2400 แปลงเป็น ค.ศ. โดยลบ 543)
 */
export function parseDateString(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const parts = trimmed.split(/[-\/]/);
  if (parts.length !== 3) return null;

  let year: number;
  let month: number;
  let day: number;

  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else if (parts[2].length === 4) {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  } else {
    const p0 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[2], 10);
    if (p0 > 1000) {
      year = p0;
      month = parseInt(parts[1], 10);
      day = p2;
    } else if (p2 > 1000) {
      day = p0;
      month = parseInt(parts[1], 10);
      year = p2;
    } else {
      return null;
    }
  }

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

  // แปลงปี พ.ศ. (> 2400) เป็น ค.ศ.
  if (year > 2400) {
    year -= 543;
  }

  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * แปลงสตริงเวลาให้อยู่ในรูปแบบ 'HH:mm:ss'
 * รองรับ 'HH:mm' หรือ 'HH:mm:ss'
 */
export function parseTimeString(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const ss = parts.length === 3 ? parseInt(parts[2], 10) : 0;

  if (isNaN(hh) || isNaN(mm) || isNaN(ss)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;

  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * แปลงสตริงวันเวลาให้อยู่ในรูปแบบ 'YYYY-MM-DD HH:mm:ss'
 */
export function parseDateTimeString(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const parts = trimmed.split(/[\sT]+/);
  if (parts.length !== 2) return null;

  const d = parseDateString(parts[0]);
  const t = parseTimeString(parts[1]);
  if (!d || !t) return null;

  return `${d} ${t}`;
}

/**
 * แปลง 'YYYY-MM-DD HH:mm:ss' เป็น epoch ms โดยใช้ Date.UTC เพื่อเลี่ยง timezone offset
 */
function parsePunchMs(p: string): number | null {
  const parts = p.trim().split(/[\sT]+/);
  if (parts.length !== 2) return null;
  const dateParts = parts[0].split('-').map(Number);
  const timeParts = parts[1].split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2) return null;
  return Date.UTC(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2],
    timeParts[0],
    timeParts[1],
    timeParts[2] || 0
  );
}

/**
 * ตัด punch ซ้ำ (devicePin, at) และเรียงลำดับตาม pin แล้วตามเวลา
 */
function finalizePunches(
  punches: Punch[],
  skipped: { line: number; reason: string }[]
): ParseAttendanceResult {
  const seen = new Set<string>();
  const deduped: Punch[] = [];

  for (const p of punches) {
    const key = `${p.devicePin}\0${p.at}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }

  deduped.sort((a, b) => {
    const pinCmp = a.devicePin.localeCompare(b.devicePin, undefined, { numeric: true });
    if (pinCmp !== 0) return pinCmp;
    return a.at.localeCompare(b.at);
  });

  return { punches: deduped, skipped };
}

/**
 * อ่านไฟล์บันทึกเวลา (ZKTeco attlog.dat หรือ CSV) และส่งคืนรายการบันทึกเวลา
 */
export function parseAttendanceFile(text: string, filename?: string): ParseAttendanceResult {
  const cleanText = (text || '').replace(/^\uFEFF/, '');
  if (!cleanText.trim()) {
    throw new Error('ไม่พบข้อมูลในไฟล์');
  }

  const rawLines = cleanText.split(/\r\n|\r|\n/);
  const nonBlankLines = rawLines.filter(l => l.trim().length > 0);

  const isDatFile = filename ? (/\.dat$/i.test(filename) || /attlog/i.test(filename)) : false;
  const hasTabDatetimePattern = nonBlankLines.some(
    l => l.includes('\t') && /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}/.test(l)
  );

  const isAttlog = isDatFile || hasTabDatetimePattern;

  if (isAttlog) {
    const punches: Punch[] = [];
    const skipped: { line: number; reason: string }[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      const lineNum = i + 1;
      if (!rawLine.trim()) {
        continue;
      }

      let cols = rawLine.split('\t');
      if (cols[0].trim() === '' && cols.length > 2) {
        cols = cols.slice(1);
      }

      if (cols.length < 2) {
        skipped.push({ line: lineNum, reason: 'รูปแบบข้อมูลไม่ถูกต้อง (ต้องมีรหัสและเวลาคั่นด้วย Tab)' });
        continue;
      }

      const pin = cols[0].trim();
      if (!pin) {
        skipped.push({ line: lineNum, reason: 'ไม่พบรหัสพนักงาน' });
        continue;
      }

      const atNormalized = parseDateTimeString(cols[1].trim());
      if (!atNormalized) {
        skipped.push({ line: lineNum, reason: 'รูปแบบวันเวลาไม่ถูกต้อง' });
        continue;
      }

      punches.push({ devicePin: pin, at: atNormalized });
    }

    if (punches.length === 0) {
      throw new Error('ไม่พบข้อมูลบันทึกเวลาที่ถูกต้องในไฟล์');
    }

    return finalizePunches(punches, skipped);
  }

  // Parse as CSV
  const parseResult = Papa.parse<string[]>(cleanText, {
    skipEmptyLines: false,
  });

  const data = parseResult.data as string[][];
  if (!data || data.length === 0) {
    throw new Error('ไม่พบข้อมูลในไฟล์');
  }

  const headerRowIdx = data.findIndex(row => row && row.some(cell => (cell || '').trim().length > 0));
  if (headerRowIdx === -1) {
    throw new Error('ไม่พบข้อมูลในไฟล์');
  }

  const headerRow = data[headerRowIdx];
  const headers = headerRow.map(h => (h || '').trim().toLowerCase());

  const PIN_ALIASES = ['pin', 'id', 'user id', 'ac-no.', 'ac-no', 'no.', 'no', 'รหัส', 'รหัสพนักงาน'];
  const DATETIME_ALIASES = ['datetime', 'date time', 'check time', 'checktime', 'วันเวลา'];
  const DATE_ALIASES = ['date', 'วันที่'];
  const TIME_ALIASES = ['time', 'เวลา'];

  let pinColIdx = -1;
  let dateColIdx = -1;
  let timeColIdx = -1;
  let dtColIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (pinColIdx === -1 && PIN_ALIASES.includes(h)) {
      pinColIdx = i;
    }
    if (dateColIdx === -1 && DATE_ALIASES.includes(h)) {
      dateColIdx = i;
    }
    if (timeColIdx === -1 && TIME_ALIASES.includes(h)) {
      timeColIdx = i;
    }
    if (dtColIdx === -1 && DATETIME_ALIASES.includes(h)) {
      dtColIdx = i;
    }
  }

  // หากไม่มีคอลัมน์ date แยก แต่พบคอลัมน์ time/เวลา และไม่มีคอลัมน์ datetime ให้ใช้ time เป็น datetime
  if (dateColIdx === -1 && dtColIdx === -1 && timeColIdx !== -1) {
    dtColIdx = timeColIdx;
    timeColIdx = -1;
  }

  if (pinColIdx === -1) {
    throw new Error('ไม่พบคอลัมน์รหัสพนักงาน (รองรับ: pin, id, user id, ac-no., no., รหัส, รหัสพนักงาน)');
  }

  const hasSeparate = dateColIdx !== -1 && timeColIdx !== -1;
  const hasSingle = dtColIdx !== -1;

  if (!hasSeparate && !hasSingle) {
    throw new Error('ไม่พบคอลัมน์เวลาเข้าออกงาน (รองรับ: datetime, date time, วันเวลา หรือ วันที่ + เวลา)');
  }

  const punches: Punch[] = [];
  const skipped: { line: number; reason: string }[] = [];

  for (let r = headerRowIdx + 1; r < data.length; r++) {
    const row = data[r];
    const lineNum = r + 1;

    if (!row || row.every(cell => (cell || '').trim().length === 0)) {
      continue;
    }

    const pin = (row[pinColIdx] || '').trim();
    if (!pin) {
      skipped.push({ line: lineNum, reason: 'ไม่พบรหัสพนักงาน' });
      continue;
    }

    if (hasSeparate) {
      const dateRaw = (row[dateColIdx] || '').trim();
      const timeRaw = (row[timeColIdx] || '').trim();

      if (!dateRaw || !timeRaw) {
        skipped.push({ line: lineNum, reason: 'ข้อมูลวันที่หรือเวลาไม่ครบถ้วน' });
        continue;
      }

      const parsedDate = parseDateString(dateRaw);
      if (!parsedDate) {
        skipped.push({ line: lineNum, reason: 'รูปแบบวันที่ไม่ถูกต้อง' });
        continue;
      }

      const parsedTime = parseTimeString(timeRaw);
      if (!parsedTime) {
        skipped.push({ line: lineNum, reason: 'รูปแบบเวลาไม่ถูกต้อง' });
        continue;
      }

      punches.push({ devicePin: pin, at: `${parsedDate} ${parsedTime}` });
    } else {
      const dtRaw = (row[dtColIdx] || '').trim();
      if (!dtRaw) {
        skipped.push({ line: lineNum, reason: 'ไม่พบข้อมูลวันเวลา' });
        continue;
      }

      const parsedDt = parseDateTimeString(dtRaw);
      if (!parsedDt) {
        skipped.push({ line: lineNum, reason: 'รูปแบบวันเวลาไม่ถูกต้อง' });
        continue;
      }

      punches.push({ devicePin: pin, at: parsedDt });
    }
  }

  if (punches.length === 0) {
    throw new Error('ไม่พบข้อมูลบันทึกเวลาที่ถูกต้องในไฟล์');
  }

  return finalizePunches(punches, skipped);
}

/**
 * สรุปเวลาการทำงานประจำวันของพนักงาน 1 คนตามกะการทำงาน
 */
export function summarizeDay(
  punches: string[],
  shift: Shift,
  workDate: string
): DaySummary {
  const [y, m, d] = workDate.split('-').map(Number);
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);

  const shiftStartMs = Date.UTC(y, m - 1, d, sh, sm, 0);
  const isOvernight = eh < sh || (eh === sh && em <= sm);
  const shiftEndMs = Date.UTC(y, m - 1, d + (isOvernight ? 1 : 0), eh, em, 0);

  // ขอบเขตเวลา: ก่อนกะเริ่ม 4 ชม. ถึง หลังกะจบ 6 ชม.
  const windowStartMs = shiftStartMs - 4 * 60 * 60 * 1000;
  const windowEndMs = shiftEndMs + 6 * 60 * 60 * 1000;

  const inWindowMsList: { at: string; ms: number }[] = [];
  const seen = new Set<string>();

  for (const p of punches) {
    const ms = parsePunchMs(p);
    if (ms !== null && ms >= windowStartMs && ms <= windowEndMs) {
      if (!seen.has(p)) {
        seen.add(p);
        inWindowMsList.push({ at: p, ms });
      }
    }
  }

  inWindowMsList.sort((a, b) => a.ms - b.ms);

  if (inWindowMsList.length === 0) {
    return {
      workDate,
      in: undefined,
      out: undefined,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      otCandidateMinutes: 0,
      missingOut: false,
      absent: true,
    };
  }

  if (inWindowMsList.length === 1) {
    const first = inWindowMsList[0];
    const diffIn = Math.floor((first.ms - shiftStartMs) / 60000);
    const lateMinutes = diffIn > shift.graceMinutes ? Math.max(0, diffIn) : 0;

    return {
      workDate,
      in: first.at,
      out: undefined,
      lateMinutes,
      earlyLeaveMinutes: 0,
      workedMinutes: 0,
      otCandidateMinutes: 0,
      missingOut: true,
      absent: false,
    };
  }

  const first = inWindowMsList[0];
  const last = inWindowMsList[inWindowMsList.length - 1];

  // lateMinutes = max(0, in - start) แต่เป็น 0 หากอยู่ในช่วง graceMinutes
  const diffIn = Math.floor((first.ms - shiftStartMs) / 60000);
  const lateMinutes = diffIn > shift.graceMinutes ? Math.max(0, diffIn) : 0;

  // earlyLeaveMinutes = max(0, end - out)
  const diffEnd = Math.floor((shiftEndMs - last.ms) / 60000);
  const earlyLeaveMinutes = Math.max(0, diffEnd);

  // workedMinutes = (out - in) - breakMinutes (ต่ำสุด 0)
  const totalWorked = Math.floor((last.ms - first.ms) / 60000);
  const workedMinutes = Math.max(0, totalWorked - (shift.breakMinutes || 0));

  // otCandidateMinutes = นาทีหลังสิ้นสุดกะ นับเฉพาะบล็อกละ 30 นาทีเต็ม
  const diffOt = Math.floor((last.ms - shiftEndMs) / 60000);
  const otCandidateMinutes = diffOt >= 30 ? Math.floor(diffOt / 30) * 30 : 0;

  return {
    workDate,
    in: first.at,
    out: last.at,
    lateMinutes,
    earlyLeaveMinutes,
    workedMinutes,
    otCandidateMinutes,
    missingOut: false,
    absent: false,
  };
}

function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const current = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));

  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * สรุปเวลาการทำงานของพนักงานทุกคนตามช่วงวันที่กำหนด
 */
export function summarizePeriod(
  punches: Punch[],
  pinToShift: (pin: string) => Shift | undefined,
  from: string,
  to: string
): PeriodSummary {
  // ponytail: ทุกวันในช่วง [from, to] ถือเป็นวันทำงานใน Phase 3a นี้
  // วันหยุดประจำสัปดาห์ / ตารางเวร / วันหยุดนักขัตฤกษ์จะนำมาคิดใน Phase ถัดไปเมื่อมีตารางข้อมูลปฏิทิน
  const dates = getDateRange(from, to);
  const uniquePins = Array.from(new Set(punches.map(p => p.devicePin))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const byPin: Record<string, EmployeePeriodSummary> = {};
  const unmapped: string[] = [];

  for (const pin of uniquePins) {
    const shift = pinToShift(pin);
    if (!shift) {
      unmapped.push(pin);
      continue;
    }

    const pinPunches = punches.filter(p => p.devicePin === pin).map(p => p.at);
    const days: DaySummary[] = [];

    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let otCandidateMinutes = 0;
    let absentDays = 0;
    let daysWorked = 0;

    for (const date of dates) {
      const daySummary = summarizeDay(pinPunches, shift, date);
      days.push(daySummary);

      lateMinutes += daySummary.lateMinutes;
      earlyLeaveMinutes += daySummary.earlyLeaveMinutes;
      otCandidateMinutes += daySummary.otCandidateMinutes;

      if (daySummary.absent) {
        absentDays += 1;
      } else if (!daySummary.missingOut) {
        daysWorked += 1;
      }
    }

    byPin[pin] = {
      days,
      totals: {
        lateMinutes,
        earlyLeaveMinutes,
        otCandidateMinutes,
        absentDays,
        daysWorked,
      },
    };
  }

  return { byPin, unmapped };
}
