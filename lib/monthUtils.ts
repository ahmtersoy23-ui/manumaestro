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
 * Check if a month is locked (in the past)
 * Months in the past cannot be edited
 * @param monthValue - Month string in format "YYYY-MM"
 * @returns true if the month is in the past
 */
export function isMonthLocked(monthValue: string): boolean {
  const monthDate = parseMonthValue(monthValue);
  const today = new Date();
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  return monthDate < currentMonth;
}

/**
 * Get list of available months for creating new requests
 * Returns current month and future months (up to 6 months ahead)
 * @returns Array of month objects with value, label, and locked status
 */
export function getAvailableMonths(): Array<{ value: string; label: string; locked: boolean }> {
  const months: Array<{ value: string; label: string; locked: boolean }> = [];
  const today = new Date();

  // Current month + 6 months ahead
  for (let i = 0; i < 7; i++) {
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
