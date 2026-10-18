/**
 * Global Date Formatting Utility for Enterprise Operations Platform.
 * Enforces strict DD-MM-YYYY format across all views, tables, modals, and drawers.
 * All displayed datetimes are rendered in IST (UTC+5:30, +330 min offset).
 */

const IST_OFFSET_MINUTES = 330;

function toIST(dateValue: string | Date): Date {
  const d = typeof dateValue === "string" ? new Date(dateValue) : new Date(dateValue.getTime());
  if (isNaN(d.getTime())) return d;
  return new Date(d.getTime() + IST_OFFSET_MINUTES * 60000);
}

export function formatDate(
  dateValue?: string | Date | null,
  fallback: string = "—"
): string {
  if (!dateValue) return fallback;

  if (typeof dateValue === "string") {
    const trimmed = dateValue.trim();
    if (!trimmed) return fallback;

    // Match YYYY-MM-DD (ISO dates, SQL date strings)
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const [, yyyy, mm, dd] = isoMatch;
      return `${dd}-${mm}-${yyyy}`;
    }

    // Match DD-MM-YYYY
    if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
      return trimmed;
    }

    // Match DD/MM/YYYY vs MM/DD/YYYY (slash format)
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const p1 = parseInt(slashMatch[1], 10);
      const p2 = parseInt(slashMatch[2], 10);
      const yyyy = slashMatch[3];
      
      // If p1 > 12, it must be DD/MM/YYYY
      // If p1 <= 12 and p2 > 12, it must be MM/DD/YYYY
      // Otherwise default to DD/MM/YYYY
      if (p1 <= 12 && p2 > 12) {
        const mm = String(p1).padStart(2, "0");
        const dd = String(p2).padStart(2, "0");
        return `${dd}-${mm}-${yyyy}`;
      } else {
        const dd = String(p1).padStart(2, "0");
        const mm = String(p2).padStart(2, "0");
        return `${dd}-${mm}-${yyyy}`;
      }
    }
  }

  const d = toIST(dateValue as Date);
  if (isNaN(d.getTime())) {
    return typeof dateValue === "string" ? dateValue : fallback;
  }

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}-${month}-${year}`;
}

export function formatDateTime(
  dateValue?: string | Date | null,
  fallback: string = "—"
): string {
  if (!dateValue) return fallback;
  const d = toIST(dateValue as Date);
  if (isNaN(d.getTime())) return formatDate(dateValue, fallback);

  const datePart = formatDate(d, fallback);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${datePart} ${hours}:${minutes}`;
}

export function parseToISO(dateValue?: string | Date | null): string | null {
  if (!dateValue) return null;
  if (typeof dateValue === "string") {
    const trimmed = dateValue.trim();
    if (!trimmed) return null;
    
    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(trimmed)) {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    
    // DD-MM-YYYY
    const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dashMatch) {
      const dd = String(dashMatch[1]).padStart(2, "0");
      const mm = String(dashMatch[2]).padStart(2, "0");
      const yyyy = dashMatch[3];
      return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
    }

    // DD/MM/YYYY or MM/DD/YYYY
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const p1 = parseInt(slashMatch[1], 10);
      const p2 = parseInt(slashMatch[2], 10);
      const yyyy = slashMatch[3];
      const dd = p1 <= 12 && p2 > 12 ? String(p2).padStart(2, "0") : String(p1).padStart(2, "0");
      const mm = p1 <= 12 && p2 > 12 ? String(p1).padStart(2, "0") : String(p2).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
    }
  }
  
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Inclusive calendar-day count between two dates.
 * Both the start date and the end date are counted, so a same-day range
 * returns 1 and a Jan 1 → Jan 5 range returns 5.
 * Returns 0 when either value is missing/invalid.
 */
export function calendarDaysBetween(
  start?: string | Date | null,
  end?: string | Date | null
): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  const msPerDay = 86400000;
  const diff = Math.round((e.getTime() - s.getTime()) / msPerDay);
  return Math.max(0, diff + 1);
}
