/**
 * Theme management — light, dark, or system preference.
 * Stored in localStorage and synced from ~/.geminirag/config.json via Settings.
 */

export type ThemeOption = "light" | "dark" | "system"

const STORAGE_KEY = "geminirag:theme"

export function getTheme(): ThemeOption {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark" || saved === "system") return saved
  } catch { /* ignore */ }
  return "light"
}

export function setTheme(theme: ThemeOption): void {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

export function applyTheme(theme: ThemeOption): void {
  const root = document.documentElement
  if (theme === "dark") {
    root.classList.add("dark")
  } else if (theme === "light") {
    root.classList.remove("dark")
  } else {
    // System preference
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
  }
}

/** Initialize theme on app startup */
export function initTheme(): void {
  applyTheme(getTheme())

  // Listen for system preference changes when in "system" mode
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") {
      applyTheme("system")
    }
  })
}
