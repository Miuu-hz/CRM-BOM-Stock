import { describe, it, expect } from 'vitest';
import {
  parseAttendanceFile,
  summarizeDay,
  summarizePeriod,
  type Shift,
  type Punch,
} from './attendance';

describe('HR Phase 3a — Attendance Module', () => {
  describe('parseAttendanceFile', () => {
    it('parses ZKTeco attlog with leading-space PINs, CRLF, and skips garbage line with line number', () => {
      // Line 1: pin with leading spaces '   101', valid punch
      // Line 2: garbage line without tab separator
      // Line 3: pin '  102', valid punch
      const rawAttlog =
        '   101\t2026-10-28 08:55:00\t1\t0\t1\t0\r\n' +
        'GARBAGE_ROW_CORRUPT_DATA\r\n' +
        '  102\t2026-10-28 09:02:15\t1\t0\t1\t0\r\n';

      const res = parseAttendanceFile(rawAttlog, 'attlog.dat');

      expect(res.punches).toHaveLength(2);
      expect(res.punches[0]).toEqual({
        devicePin: '101',
        at: '2026-10-28 08:55:00',
      });
      expect(res.punches[1]).toEqual({
        devicePin: '102',
        at: '2026-10-28 09:02:15',
      });

      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0].line).toBe(2);
      expect(res.skipped[0].reason).toContain('รูปแบบข้อมูลไม่ถูกต้อง');
    });

    it('detects attlog by content pattern even without .dat filename', () => {
      const content = '101\t2026-10-28 08:30:00\t1\t0\n102\t2026-10-28 08:35:00\t1\t0';
      const res = parseAttendanceFile(content); // no filename provided

      expect(res.punches).toHaveLength(2);
      expect(res.punches[0].devicePin).toBe('101');
      expect(res.punches[1].devicePin).toBe('102');
      expect(res.skipped).toHaveLength(0);
    });

    it('parses CSV with Thai headers + DD/MM/2569 Buddhist dates and UTF-8 BOM', () => {
      // UTF-8 BOM + Thai headers (รหัสพนักงาน, วันเวลา)
      // Buddhist year 2569 - 543 = 2026
      const csv =
        '\uFEFFรหัสพนักงาน,วันเวลา\r\n' +
        '101,28/10/2569 08:30:00\r\n' +
        '102,28/10/2569 17:30:00\r\n';

      const res = parseAttendanceFile(csv, 'attendance.csv');

      expect(res.punches).toHaveLength(2);
      expect(res.punches[0]).toEqual({
        devicePin: '101',
        at: '2026-10-28 08:30:00',
      });
      expect(res.punches[1]).toEqual({
        devicePin: '102',
        at: '2026-10-28 17:30:00',
      });
      expect(res.skipped).toHaveLength(0);
    });

    it('parses CSV with separate date/time columns in Thai and English', () => {
      // Thai separate columns: รหัส, วันที่, เวลา
      const thaiCsv =
        'รหัส,วันที่,เวลา\n' +
        '101,28/10/2569,08:30\n' +
        '101,28/10/2569,17:30:00\n';

      const resThai = parseAttendanceFile(thaiCsv);
      expect(resThai.punches).toEqual([
        { devicePin: '101', at: '2026-10-28 08:30:00' },
        { devicePin: '101', at: '2026-10-28 17:30:00' },
      ]);

      // English separate columns: pin, date, time
      const engCsv =
        'pin,date,time\n' +
        '201,2026-10-28,09:00:00\n' +
        '201,2026-10-28,18:00\n';

      const resEng = parseAttendanceFile(engCsv);
      expect(resEng.punches).toEqual([
        { devicePin: '201', at: '2026-10-28 09:00:00' },
        { devicePin: '201', at: '2026-10-28 18:00:00' },
      ]);
    });

    it('deduplicates identical (devicePin, at) pairs and returns punches sorted by pin then time', () => {
      const csv =
        'pin,datetime\n' +
        '102,2026-10-28 08:30:00\n' +
        '101,2026-10-28 17:30:00\n' +
        '101,2026-10-28 08:30:00\n' +
        '101,2026-10-28 08:30:00\n'; // duplicate

      const res = parseAttendanceFile(csv);

      expect(res.punches).toHaveLength(3);
      expect(res.punches).toEqual([
        { devicePin: '101', at: '2026-10-28 08:30:00' },
        { devicePin: '101', at: '2026-10-28 17:30:00' },
        { devicePin: '102', at: '2026-10-28 08:30:00' },
      ]);
    });

    it('records bad rows in CSV to skipped and does not throw if at least one row is valid', () => {
      const csv =
        'pin,datetime\n' +
        '101,2026-10-28 08:30:00\n' +
        ',2026-10-28 08:35:00\n' + // line 3: missing pin
        '102,not-a-valid-date\n'; // line 4: invalid datetime

      const res = parseAttendanceFile(csv);

      expect(res.punches).toEqual([
        { devicePin: '101', at: '2026-10-28 08:30:00' },
      ]);
      expect(res.skipped).toHaveLength(2);
      expect(res.skipped[0].line).toBe(3);
      expect(res.skipped[0].reason).toContain('ไม่พบรหัสพนักงาน');
      expect(res.skipped[1].line).toBe(4);
      expect(res.skipped[1].reason).toContain('รูปแบบวันเวลาไม่ถูกต้อง');
    });

    it('throws Thai error when file is empty or completely unrecognizable', () => {
      expect(() => parseAttendanceFile('')).toThrow('ไม่พบข้อมูลในไฟล์');
      expect(() => parseAttendanceFile('   \n  \r\n  ')).toThrow('ไม่พบข้อมูลในไฟล์');
      expect(() => parseAttendanceFile('col_a,col_b\nfoo,bar')).toThrow(
        'ไม่พบคอลัมน์รหัสพนักงาน'
      );
    });
  });

  describe('summarizeDay', () => {
    it('day shift 09:00-18:00 grace 10 break 60: in 09:12 out 18:45 → late 12, ot 30, worked 513', () => {
      const shift: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 10,
        breakMinutes: 60,
      };

      const punches = [
        '2026-10-28 09:12:00',
        '2026-10-28 18:45:00',
      ];

      const res = summarizeDay(punches, shift, '2026-10-28');

      // (18:45 - 09:12) = 9h 33m = 573m; break = 60m => worked = 513m
      // late = 12m (> grace 10 => 12m)
      // ot = 45m after 18:00 => whole blocks of 30 min => 30m
      expect(res).toEqual({
        workDate: '2026-10-28',
        in: '2026-10-28 09:12:00',
        out: '2026-10-28 18:45:00',
        lateMinutes: 12,
        earlyLeaveMinutes: 0,
        workedMinutes: 513,
        otCandidateMinutes: 30,
        missingOut: false,
        absent: false,
      });
    });

    it('night shift 22:00-06:00 crossing midnight with punches 21:55 and 06:40 next day → late 0, ot 30 (40 → 30), assigned to the start date', () => {
      const shift: Shift = {
        start: '22:00',
        end: '06:00',
        graceMinutes: 10,
        breakMinutes: 0,
      };

      const punches = [
        '2026-10-28 21:55:00',
        '2026-10-29 06:40:00',
      ];

      const res = summarizeDay(punches, shift, '2026-10-28');

      // in 21:55 before 22:00 => late 0
      // out 06:40 (next day) after 06:00 => 40m after end => whole blocks of 30 min => 30m OT
      // worked: 21:55 to 06:40 next day = 8h 45m = 525m
      expect(res).toEqual({
        workDate: '2026-10-28',
        in: '2026-10-28 21:55:00',
        out: '2026-10-29 06:40:00',
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 525,
        otCandidateMinutes: 30,
        missingOut: false,
        absent: false,
      });
    });

    it('single punch → missingOut: true, no worked minutes, absent: false', () => {
      const shift: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 10,
        breakMinutes: 60,
      };

      const punches = ['2026-10-28 09:12:00'];
      const res = summarizeDay(punches, shift, '2026-10-28');

      expect(res).toEqual({
        workDate: '2026-10-28',
        in: '2026-10-28 09:12:00',
        out: undefined,
        lateMinutes: 12,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        otCandidateMinutes: 0,
        missingOut: true,
        absent: false,
      });
    });

    it('no punch in window → absent: true, missingOut: false', () => {
      const shift: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 10,
        breakMinutes: 60,
      };

      const res = summarizeDay([], shift, '2026-10-28');

      expect(res).toEqual({
        workDate: '2026-10-28',
        in: undefined,
        out: undefined,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        otCandidateMinutes: 0,
        missingOut: false,
        absent: true,
      });
    });

    it('respects grace period tolerance (late 10 min with grace 10 is 0 late; 11 min is 11 late)', () => {
      const shift: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 10,
        breakMinutes: 60,
      };

      // Exact grace threshold: 09:10 => late 0
      const resAtGrace = summarizeDay(
        ['2026-10-28 09:10:00', '2026-10-28 18:00:00'],
        shift,
        '2026-10-28'
      );
      expect(resAtGrace.lateMinutes).toBe(0);

      // Over grace threshold: 09:11 => late 11 (tolerance, not deduction threshold)
      const resOverGrace = summarizeDay(
        ['2026-10-28 09:11:00', '2026-10-28 18:00:00'],
        shift,
        '2026-10-28'
      );
      expect(resOverGrace.lateMinutes).toBe(11);
    });

    it('computes early leave minutes correctly', () => {
      const shift: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 0,
        breakMinutes: 0,
      };

      // Leaves 25 minutes early at 17:35
      const res = summarizeDay(
        ['2026-10-28 09:00:00', '2026-10-28 17:35:00'],
        shift,
        '2026-10-28'
      );

      expect(res.earlyLeaveMinutes).toBe(25);
      expect(res.otCandidateMinutes).toBe(0);
      expect(res.workedMinutes).toBe(515); // 8h 35m
    });

    it('ignores punches outside window (start - 4h to end + 6h)', () => {
      const shift: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 0,
        breakMinutes: 0,
      };

      // Window is 05:00:00 to 2026-10-29 00:00:00
      // 04:30 is before window -> ignored
      // 09:00 is in window
      // 18:00 is in window
      // 2026-10-29 01:00 is after window -> ignored
      const punches = [
        '2026-10-28 04:30:00',
        '2026-10-28 09:00:00',
        '2026-10-28 18:00:00',
        '2026-10-29 01:00:00',
      ];

      const res = summarizeDay(punches, shift, '2026-10-28');
      expect(res.in).toBe('2026-10-28 09:00:00');
      expect(res.out).toBe('2026-10-28 18:00:00');
    });
  });

  describe('summarizePeriod', () => {
    it('computes period totals per pin across date range and lists unmapped pins', () => {
      const shiftDay: Shift = {
        start: '09:00',
        end: '18:00',
        graceMinutes: 10,
        breakMinutes: 60,
      };

      // Pin 101: mapped to shiftDay
      // Pin 999: no shift mapping
      const pinToShift = (pin: string) => {
        if (pin === '101') return shiftDay;
        return undefined;
      };

      const punches: Punch[] = [
        // Pin 101 on 2026-10-01 (Day 1): late 12, ot 30, worked 513
        { devicePin: '101', at: '2026-10-01 09:12:00' },
        { devicePin: '101', at: '2026-10-01 18:45:00' },
        // Pin 101 on 2026-10-02 (Day 2): single punch -> missingOut: true
        { devicePin: '101', at: '2026-10-02 09:00:00' },
        // Pin 101 on 2026-10-03 (Day 3): no punch -> absent: true
        // Pin 999: punch exists but unmapped
        { devicePin: '999', at: '2026-10-01 09:00:00' },
      ];

      const period = summarizePeriod(punches, pinToShift, '2026-10-01', '2026-10-03');

      // Unmapped pins
      expect(period.unmapped).toEqual(['999']);

      // Mapped pin 101
      const emp101 = period.byPin['101'];
      expect(emp101).toBeDefined();
      expect(emp101.days).toHaveLength(3);

      // Day 1: worked
      expect(emp101.days[0].workDate).toBe('2026-10-01');
      expect(emp101.days[0].workedMinutes).toBe(513);
      expect(emp101.days[0].lateMinutes).toBe(12);
      expect(emp101.days[0].otCandidateMinutes).toBe(30);
      expect(emp101.days[0].missingOut).toBe(false);
      expect(emp101.days[0].absent).toBe(false);

      // Day 2: missing out
      expect(emp101.days[1].workDate).toBe('2026-10-02');
      expect(emp101.days[1].missingOut).toBe(true);
      expect(emp101.days[1].workedMinutes).toBe(0);

      // Day 3: absent
      expect(emp101.days[2].workDate).toBe('2026-10-03');
      expect(emp101.days[2].absent).toBe(true);

      // Totals
      expect(emp101.totals).toEqual({
        lateMinutes: 12,
        earlyLeaveMinutes: 0,
        otCandidateMinutes: 30,
        absentDays: 1,
        daysWorked: 1, // Only Day 1 had both in & out
      });
    });
  });
});
