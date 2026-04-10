import { useState } from "react"
import { Settings, Plus } from "lucide-react"
import { Separator } from "../components/ui/separator"
import { Button } from "../components/ui/button"
import { useAppStore } from "../store"
import { WorkspaceSidebar } from "../components/WorkspaceSidebar"
import { UploadsTab } from "../components/UploadsTab"
import { AskTab } from "../components/AskTab"
import { UploadDetail } from "../components/UploadDetail"
import { SettingsDialog } from "../components/SettingsDialog"
import { AddContentDialog } from "../components/AddContentDialog"

export function AppLayout() {
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const selectedWorkspace = useAppStore((s) => s.selectedWorkspace)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addContentOpen, setAddContentOpen] = useState(false)

  return (
    <div className="flex h-screen w-full">
      {/* Sidebar */}
      <aside className="flex w-[250px] shrink-0 flex-col border-r">
        <WorkspaceSidebar />
      </aside>

      {/* Content area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex h-12 items-center border-b bg-header-bg px-4">
          {/* Left: title */}
          <h1 className="text-xl font-bold tracking-tight">G-Ragger</h1>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right group: Add Content + tab toggle + settings */}
          <div className="flex items-center gap-2">
            {/* Add Content button */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium transition-colors duration-150"
              onClick={() => setAddContentOpen(true)}
              disabled={!selectedWorkspace}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Content
            </Button>

            <Separator orientation="vertical" className="h-6" />

            {/* Segmented tab toggle */}
            <div className="inline-flex items-center rounded-lg border bg-background p-0.5">
              <button
                onClick={() => setActiveTab("uploads")}
                className={`rounded-md px-3.5 py-1 text-xs font-medium transition-all duration-150 ${
                  activeTab === "uploads"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Uploads
              </button>
              <button
                onClick={() => setActiveTab("ask")}
                className={`rounded-md px-3.5 py-1 text-xs font-medium transition-all duration-150 ${
                  activeTab === "ask"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Ask
              </button>
            </div>

            <Separator orientation="vertical" className="h-6" />

            {/* Settings gear */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 transition-colors duration-150"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4">
          <div className="flex h-full flex-col">
            {activeTab === "uploads" ? <UploadsTab /> : <AskTab />}
          </div>
        </div>
      </main>
      <UploadDetail />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AddContentDialog open={addContentOpen} onOpenChange={setAddContentOpen} />
    </div>
  )
}
