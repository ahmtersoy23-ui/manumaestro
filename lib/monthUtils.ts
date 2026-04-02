/**
 * Month Utilities
 * Helper functions for handling production months
 */

/**
 * Parse month value from string to date
 * @param monthValue - Month string in format "YYYY-MM" (e.g., "2025-01")
 * @returns Date object for the first day of that month
 */
export function parseMonthValue(monthValue: string): Date {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/**
 * Format date to month value string
 * @param date - Date object
 * @returns Month string in format "YYYY-MM" (e.g., "2025-01")
 */
export function formatMonthValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Format month value for display
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns Formatted string (e.g., "January 2025")
 */
export function formatMonthDisplay(monthValue: string): string {
  const date = parseMonthValue(monthValue);
  return date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}

/**
 * Check if a month is locked for NEW entries
 * Rule: A production month locks on the 1st of that month.
 * Example: "2026-04" entries close on April 1st (entries made during March).
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns true if the month is locked for new entries
 */
export function isMonthLocked(monthValue: string): boolean {
  const monthDate = parseMonthValue(monthValue);
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Locked if today >= the 1st of the production month
  return todayStart >= monthDate;
}

/**
 * Get active months for display (Dashboard)
 * Shows: current month (locked) + next 2 months (open for entry) + previous 1 month
 * @returns Array of month objects with value, label, and locked status
 */
export function getActiveMonths(): Array<{ value: string; label: string; locked: boolean }> {
  const months: Array<{ value: string; label: string; locked: boolean }> = [];
  const today = new Date();

  // Previous 1 + current + next 2 = 4 months
  for (let i = -1; i <= 2; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthValue = formatMonthValue(date);

    months.push({
      value: monthValue,
      label: formatMonthDisplay(monthValue),
      locked: isMonthLocked(monthValue),
    });
  }

  return months;
}

/**
 * Get list of available months for creating new requests (dropdown)
 * Normal users: only unlocked (future) months.
 * Admin: all active months regardless of lock status.
 * @param adminBypass - if true, return all months including locked ones
 * @returns Array of month objects with value and label
 */
export function getAvailableMonthsForEntry(adminBypass = false): Array<{ value: string; label: string }> {
  if (adminBypass) {
    // Admin: include all months (locked + unlocked), broader range
    return getAllMonthsForViewing(6)
      .reverse() // chronological order
      .map(month => ({ value: month.value, label: month.label }));
  }

  const activeMonths = getActiveMonths();
  return activeMonths
    .filter(month => !month.locked)
    .map(month => ({
      value: month.value,
      label: month.label,
    }));
}

/**
 * Get all months for viewing (including past months)
 * Returns last N months + current month + next 6 months
 * @param pastMonths - Number of past months to include (default: 12)
 * @returns Array of month objects with value, label, and locked status
 */
export function getAllMonthsForViewing(pastMonths: number = 12): Array<{ value: string; label: string; locked: boolean }> {
  const months: Array<{ value: string; label: string; locked: boolean }> = [];
  const today = new Date();

  // Last N months + current + next 6 months
  for (let i = -pastMonths; i < 7; i++) {
    const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthValue = formatMonthValue(date);
    months.push({
      value: monthValue,
      label: formatMonthDisplay(monthValue),
      locked: isMonthLocked(monthValue),
    });
  }

  return months.reverse(); // Most recent first
}

/**
 * Get the current month value
 * @returns Current month string in format "YYYY-MM"
 */
export function getCurrentMonth(): string {
  return formatMonthValue(new Date());
}

/**
 * Get month name from month value
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns Month name (e.g., "January")
 */
export function getMonthName(monthValue: string): string {
  const date = parseMonthValue(monthValue);
  return date.toLocaleDateString('tr-TR', { month: 'long' });
}

/**
 * Get year from month value
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns Year number
 */
export function getYear(monthValue: string): number {
  return parseMonthValue(monthValue).getFullYear();
}
