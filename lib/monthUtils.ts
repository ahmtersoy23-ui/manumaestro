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
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Check if a month is locked for NEW entries
 * Rule: After the 5th day of a month, that month becomes locked
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns true if the month is locked for new entries
 */
export function isMonthLocked(monthValue: string): boolean {
  const monthDate = parseMonthValue(monthValue);
  const today = new Date();
  const dayOfMonth = today.getDate();

  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // If month is in the past, it's locked
  if (monthDate < currentMonth) {
    return true;
  }

  // If month is current month and we're past day 5, it's locked
  if (monthDate.getTime() === currentMonth.getTime() && dayOfMonth >= 5) {
    return true;
  }

  // Otherwise, not locked
  return false;
}

/**
 * Get active months for display (Dashboard)
 * Rule:
 * - Before 5th of month: current + previous 2 + next 2 = 5 months
 *   Example (Feb 4): Dec, Jan, Feb, Mar, Apr
 * - After 5th of month: current + previous 1 + next 2 = 4 months
 *   Example (Feb 11): Jan, Feb, Mar, Apr
 * @returns Array of month objects with value, label, and locked status
 */
export function getActiveMonths(): Array<{ value: string; label: string; locked: boolean }> {
  const months: Array<{ value: string; label: string; locked: boolean }> = [];
  const today = new Date();
  const dayOfMonth = today.getDate();

  let startOffset: number;
  let endOffset: number;

  if (dayOfMonth < 5) {
    // Before 5th: current + previous 2 + next 2 = 5 months
    startOffset = -2;
    endOffset = 2;
  } else {
    // After 5th: current + previous 1 + next 2 = 4 months
    startOffset = -1;
    endOffset = 2;
  }

  for (let i = startOffset; i <= endOffset; i++) {
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
 * Only unlocked months from active months
 * @returns Array of month objects with value and label
 */
export function getAvailableMonthsForEntry(): Array<{ value: string; label: string }> {
  // Get active months and filter out locked ones
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
  return date.toLocaleDateString('en-US', { month: 'long' });
}

/**
 * Get year from month value
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns Year number
 */
export function getYear(monthValue: string): number {
  return parseMonthValue(monthValue).getFullYear();
}
