import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { useAppStore } from "../store"
import { type DateFormatOption, getDateFormat, setDateFormat } from "../lib/date-format"
import { type ThemeOption, getTheme, setTheme } from "../lib/theme"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CONFIG_FIELDS = [
  {
    key: "GEMINI_API_KEY",
    label: "Gemini API Key",
    type: "password" as const,
    required: true,
    placeholder: "Your Google AI Studio API key",
  },
  {
    key: "GEMINI_MODEL",
    label: "Gemini Model",
    type: "text" as const,
    required: true,
    placeholder: "e.g., gemini-2.5-flash",
  },
  {
    key: "GEMINI_API_KEY_EXPIRATION",
    label: "Gemini API Key Expiration",
    type: "date" as const,
    required: false,
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "YOUTUBE_DATA_API_KEY",
    label: "YouTube Data API Key",
    type: "password" as const,
    required: false,
    placeholder: "Optional, required for channel-scan",
  },
  {
    key: "YOUTUBE_DATA_API_KEY_EXPIRATION",
    label: "YouTube Data API Key Expiration",
    type: "date" as const,
    required: false,
    placeholder: "YYYY-MM-DD",
  },
]

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const validateConfig = useAppStore((s) => s.validateConfig)

  const [config, setConfig] = useState<Record<string, string>>({})
  const [filePath, setFilePath] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFormat, setDateFormatState] = useState<DateFormatOption>(getDateFormat())
  const [themeOption, setThemeOption] = useState<ThemeOption>(getTheme())

  useEffect(() => {
    if (open) {
      loadConfig()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const loadConfig = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.config.get()
      if (result.success) {
        setConfig(result.data.config)
        setFilePath(result.data.filePath)
        // Sync date format from config
        const savedFmt = result.data.config.DATE_FORMAT
        if (savedFmt === "DD/MM/YYYY" || savedFmt === "MM/DD/YYYY" || savedFmt === "YYYY-MM-DD") {
          setDateFormatState(savedFmt)
          setDateFormat(savedFmt)
        }
        const savedTheme = result.data.config.THEME
        if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") {
          setThemeOption(savedTheme)
          setTheme(savedTheme)
        }
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration")
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setError(null)

    // Validate required fields
    for (const field of CONFIG_FIELDS) {
      if (field.required && !config[field.key]?.trim()) {
        setError(`${field.label} is required.`)
        return
      }
    }

    setSaving(true)
    try {
      // Remove empty optional fields
      const cleanConfig: Record<string, string> = {}
      for (const [key, value] of Object.entries(config)) {
        if (value?.trim()) {
          cleanConfig[key] = value.trim()
        }
      }

      // Include UI preferences in config
      cleanConfig.DATE_FORMAT = dateFormat
      cleanConfig.THEME = themeOption

      const result = await window.api.config.save(cleanConfig)
      if (result.success) {
        // Apply preferences locally
        setDateFormat(dateFormat)
        setTheme(themeOption)
        await validateConfig()
        onOpenChange(false)
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration")
    } finally {
      setSaving(false)
    }
  }

  const updateField = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure G-Ragger API keys and model settings.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {CONFIG_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key} className="text-sm font-medium">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <Input
                  id={field.key}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={config[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                />
              </div>
            ))}

            <div className="space-y-1.5">
              <Label htmlFor="date-format" className="text-sm font-medium">
                Date Format
              </Label>
              <Select
                value={dateFormat}
                onValueChange={(v) => setDateFormatState(v as DateFormatOption)}
              >
                <SelectTrigger id="date-format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (European)</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (US)</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="theme" className="text-sm font-medium">
                Theme
              </Label>
              <Select
                value={themeOption}
                onValueChange={(v) => {
                  setThemeOption(v as ThemeOption)
                  setTheme(v as ThemeOption)
                }}
              >
                <SelectTrigger id="theme" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-error-bg px-3 py-2 text-sm text-error-foreground">
                {error}
              </div>
            )}

            {filePath && (
              <p className="text-xs text-muted-foreground">
                Config file: {filePath}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
