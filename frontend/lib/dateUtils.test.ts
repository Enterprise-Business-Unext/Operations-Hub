import { formatDate, formatDateTime, parseToISO, calendarDaysBetween } from '@/lib/dateUtils';

describe('dateUtils', () => {
  describe('formatDate', () => {
    it('returns fallback for null/undefined', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDate(undefined)).toBe('—');
      expect(formatDate('')).toBe('—');
    });

    it('formats ISO date string (YYYY-MM-DD) to DD-MM-YYYY', () => {
      expect(formatDate('2024-01-15')).toBe('15-01-2024');
      expect(formatDate('2024-12-31')).toBe('31-12-2024');
    });

    it('handles DD-MM-YYYY format', () => {
      expect(formatDate('15-01-2024')).toBe('15-01-2024');
    });

    it('converts MM/DD/YYYY to DD-MM-YYYY when month <= 12 and day > 12', () => {
      expect(formatDate('01/15/2024')).toBe('15-01-2024');
    });

    it('converts DD/MM/YYYY to DD-MM-YYYY when day > 12', () => {
      expect(formatDate('15/01/2024')).toBe('15-01-2024');
    });

    it('handles Date objects', () => {
      const date = new Date('2024-01-15');
      expect(formatDate(date)).toBe('15-01-2024');
    });

    it('returns fallback for invalid date', () => {
      expect(formatDate('invalid')).toBe('invalid');
    });
  });

  describe('formatDateTime', () => {
    it('returns fallback for null/undefined', () => {
      expect(formatDateTime(null)).toBe('—');
    });

    it('formats ISO datetime string in IST', () => {
      expect(formatDateTime('2024-01-15T14:30:00')).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    });

    it('handles Date objects in IST', () => {
      const date = new Date('2024-01-15T14:30:00');
      expect(formatDateTime(date)).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    });
  });

  describe('parseToISO', () => {
    it('returns null for null/undefined', () => {
      expect(parseToISO(null)).toBeNull();
      expect(parseToISO(undefined)).toBeNull();
    });

    it('returns ISO string for already ISO format', () => {
      const result = parseToISO('2024-01-15T14:30:00');
      // Result will be in UTC, exact time depends on timezone
      expect(result).toMatch(/^2024-01-15T\d{2}:\d{2}:\d{2}\.000Z$/);
    });

    it('converts DD-MM-YYYY to ISO', () => {
      expect(parseToISO('15-01-2024')).toBe('2024-01-15T00:00:00.000Z');
    });

    it('converts MM/DD/YYYY to ISO', () => {
      expect(parseToISO('01/15/2024')).toBe('2024-01-15T00:00:00.000Z');
    });

    it('converts DD/MM/YYYY to ISO', () => {
      expect(parseToISO('15/01/2024')).toBe('2024-01-15T00:00:00.000Z');
    });

    it('returns null for invalid date', () => {
      expect(parseToISO('invalid')).toBeNull();
    });
  });

  describe('calendarDaysBetween', () => {
    it('returns 0 when either date is missing', () => {
      expect(calendarDaysBetween(null, '2024-01-15')).toBe(0);
      expect(calendarDaysBetween('2024-01-15', null)).toBe(0);
      expect(calendarDaysBetween(undefined, undefined)).toBe(0);
    });

    it('returns 0 for invalid dates', () => {
      expect(calendarDaysBetween('invalid', '2024-01-15')).toBe(0);
      expect(calendarDaysBetween('2024-01-15', 'nope')).toBe(0);
    });

    it('counts both endpoints inclusively (same day = 1)', () => {
      expect(calendarDaysBetween('2024-01-15', '2024-01-15')).toBe(1);
    });

    it('counts inclusively across a range', () => {
      expect(calendarDaysBetween('2024-01-01', '2024-01-05')).toBe(5);
      expect(calendarDaysBetween('2024-01-01', '2024-01-31')).toBe(31);
    });

    it('returns 0 when end is before start', () => {
      expect(calendarDaysBetween('2024-01-10', '2024-01-05')).toBe(0);
    });

    it('accepts Date objects', () => {
      expect(
        calendarDaysBetween(new Date('2024-01-01T00:00:00Z'), new Date('2024-01-05T00:00:00Z'))
      ).toBe(5);
    });
  });
});