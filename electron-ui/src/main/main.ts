import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'node:fs'
import os from 'node:os'
import { registerIpcHandlers } from './ipc-handlers.js'
import { initialize } from './service-bridge.js'

// ===== Window State Persistence =====

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

const STATE_FILE = path.join(os.homedir(), '.g-ragger', 'window-state.json')

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf-8')
      return JSON.parse(data) as WindowState
    }
  } catch {
    // Corrupted file — use defaults
  }
  return { width: 1200, height: 800 }
}

function saveWindowState(win: BrowserWindow): void {
  const isMaximized = win.isMaximized()
  const bounds = isMaximized ? (win as any)._lastBounds ?? win.getBounds() : win.getBounds()
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  }
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // Non-fatal
  }
}

function createWindow(): void {
  const saved = loadWindowState()

  const mainWindow = new BrowserWindow({
    title: 'G-Ragger',
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/index.js')
    }
  })

  if (saved.isMaximized) {
    mainWindow.maximize()
  }

  // Track normal bounds before maximize so we can restore them
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      (mainWindow as any)._lastBounds = mainWindow.getBounds()
    }
  })
  mainWindow.on('move', () => {
    if (!mainWindow.isMaximized()) {
      (mainWindow as any)._lastBounds = mainWindow.getBounds()
    }
  })

  mainWindow.on('close', () => {
    saveWindowState(mainWindow)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  // Initialize service bridge asynchronously (don't block window creation)
  initialize()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
