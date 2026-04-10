import { useEffect, useState } from "react"
import { useAppStore } from "./store"
import { AppLayout } from "./layout/AppLayout"
import { ErrorBanner } from "./components/ErrorBanner"
import { LoadingSpinner } from "./components/LoadingSpinner"
import { setDateFormat } from "./lib/date-format"
import { setTheme } from "./lib/theme"

function App(): JSX.Element {
  const validateConfig = useAppStore((s) => s.validateConfig)
  const configValid = useAppStore((s) => s.configValid)
  const configError = useAppStore((s) => s.configError)
  const configWarnings = useAppStore((s) => s.configWarnings)
  const [initializing, setInitializing] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Load date format from config on startup
    window.api.config.get().then((result) => {
      if (result.success) {
        const fmt = result.data.config.DATE_FORMAT
        if (fmt === "DD/MM/YYYY" || fmt === "MM/DD/YYYY" || fmt === "YYYY-MM-DD") {
          setDateFormat(fmt)
        }
        const theme = result.data.config.THEME
        if (theme === "light" || theme === "dark" || theme === "system") {
          setTheme(theme)
        }
      }
    }).catch(() => { /* non-fatal */ })

    validateConfig().finally(() => setInitializing(false))
  }, [validateConfig])

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner label="Initializing..." size={32} />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      {configError && !dismissed && (
        <ErrorBanner
          message={configError}
          onDismiss={() => setDismissed(true)}
          className="m-2"
        />
      )}
      {configWarnings.length > 0 &&
        configWarnings.map((warning, i) => (
          <div
            key={i}
            className="m-2 rounded-md border border-warning-foreground/30 bg-warning-bg px-4 py-2 text-sm text-warning-foreground"
          >
            {warning}
          </div>
        ))}
      {configValid || dismissed ? (
        <div className="flex-1 overflow-hidden">
          <AppLayout />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p>Please fix configuration errors to continue.</p>
        </div>
      )}
    </div>
  )
}

export default App
