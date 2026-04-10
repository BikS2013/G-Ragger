/**
 * Date formatting utility that reads DATE_FORMAT from localStorage
 * (synced from ~/.geminirag/config.json via the Settings dialog).
 *
 * Supported formats:
 *   "DD/MM/YYYY" (European, default)
 *   "MM/DD/YYYY" (US)
 *   "YYYY-MM-DD" (ISO)
 */

export type DateFormatOption = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"

const STORAGE_KEY = "geminirag:date-format"
const DEFAULT_FORMAT: DateFormatOption = "DD/MM/YYYY"

export function getDateFormat(): DateFormatOption {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "DD/MM/YYYY" || saved === "MM/DD/YYYY" || saved === "YYYY-MM-DD") {
      return saved
    }
  } catch { /* ignore */ }
  return DEFAULT_FORMAT
}

export function setDateFormat(format: DateFormatOption): void {
  localStorage.setItem(STORAGE_KEY, format)
}

/**
 * Format an ISO date string as a short date (date only, no time).
 */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso

  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()

  const fmt = getDateFormat()
  switch (fmt) {
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`
  }
}

/**
 * Format an ISO datetime string as date + time.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso

  const hours = String(d.getHours()).padStart(2, "0")
  const minutes = String(d.getMinutes()).padStart(2, "0")

  return `${formatDate(iso)}, ${hours}:${minutes}`
}
