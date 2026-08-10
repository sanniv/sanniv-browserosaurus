import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, screen } from 'electron'

import { database } from './database.js'
import {
  changedPickerWindowBounds,
  gotDefaultBrowserStatus,
} from './state/actions.js'
import { dispatch } from './state/store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

declare const PREFS_WINDOW_VITE_DEV_SERVER_URL: string
declare const PICKER_WINDOW_VITE_DEV_SERVER_URL: string
declare const PREFS_WINDOW_VITE_NAME: string
declare const PICKER_WINDOW_VITE_NAME: string

// Prevents garbage collection
let pickerWindow: BrowserWindow | null | undefined
let prefsWindow: BrowserWindow | null | undefined

let pickerShownAt = 0

const debugLogPath = path.join(
  os.homedir(),
  'Library/Logs/Browserosaurus.debug.log',
)

function debugLog(message: string): void {
  try {
    fs.appendFileSync(debugLogPath, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging must never break the app
  }
}

async function createPickerWindow(): Promise<void> {
  const height = database.get('height')

  pickerWindow = new BrowserWindow({
    alwaysOnTop: true,
    center: true,
    frame: true,
    fullscreen: false,
    fullscreenable: false,
    hasShadow: true,
    height,
    icon: path.join(__dirname, '/icon/icon.png'),
    maximizable: false,
    maxWidth: 250,
    minHeight: 112,
    minimizable: false,
    minWidth: 250,
    movable: false,
    resizable: true,
    show: false,
    title: 'Browserosaurus',
    titleBarStyle: 'hidden',
    transparent: true,
    // Non-activating panel: shows on active space without switching
    type: 'panel',
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    width: 250,
  })

  pickerWindow.setWindowButtonVisibility(false)

  pickerWindow.setAlwaysOnTop(true, 'screen-saver')

  pickerWindow.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  })

  pickerWindow.on('close', (event_) => {
    event_.preventDefault()
    pickerWindow?.hide()
  })

  pickerWindow.on('resize', () => {
    if (pickerWindow) {
      dispatch(changedPickerWindowBounds(pickerWindow.getBounds()))
    }
  })

  pickerWindow.on('blur', () => {
    // A Space-switch animation blurs the window right after show;
    // hiding then would make the picker flash and vanish (issue #595)
    if (Date.now() - pickerShownAt < 500) {
      debugLog('blur ignored (just shown); refocusing')
      pickerWindow?.focus()

      return
    }

    pickerWindow?.hide()
  })

  // A long-lived hidden window keeps a stale Space binding that macOS
  // swooshes to when the app is activated (issue #595). Recreate the
  // window after every use so each show starts with no Space binding.
  pickerWindow.on('hide', () => {
    debugLog('picker hidden; recreating fresh window')
    setTimeout(() => {
      const oldWindow = pickerWindow
      pickerWindow = undefined
      oldWindow?.destroy()
      createPickerWindow()
    }, 0)
  })

  await (PICKER_WINDOW_VITE_DEV_SERVER_URL
    ? pickerWindow.loadURL(PICKER_WINDOW_VITE_DEV_SERVER_URL)
    : pickerWindow.loadFile(
        path.join(
          __dirname,
          `../renderer/${PICKER_WINDOW_VITE_NAME}/index.html`,
        ),
      ))
}

async function createWindows(): Promise<void> {
  prefsWindow = new BrowserWindow({
    // Only show on demand
    show: false,

    // Chrome
    center: true,
    fullscreen: false,
    fullscreenable: false,
    height: 500,
    maximizable: false,
    minimizable: false,
    resizable: false,
    titleBarStyle: 'hidden',
    transparent: true,
    vibrancy: 'window',
    width: 600,

    // Meta
    icon: path.join(__dirname, '/icon/icon.png'),
    title: 'Preferences',

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  prefsWindow.on('hide', () => {
    prefsWindow?.hide()
  })

  prefsWindow.on('close', (event_) => {
    event_.preventDefault()
    prefsWindow?.hide()
  })

  prefsWindow.on('show', () => {
    // There isn't a listener for default protocol client, therefore the check
    // is made each time the window is brought into focus.
    dispatch(gotDefaultBrowserStatus(app.isDefaultProtocolClient('http')))
  })

  await Promise.all([
    PREFS_WINDOW_VITE_DEV_SERVER_URL
      ? prefsWindow.loadURL(PREFS_WINDOW_VITE_DEV_SERVER_URL)
      : prefsWindow.loadFile(
          path.join(
            __dirname,
            `../renderer/${PREFS_WINDOW_VITE_NAME}/index.html`,
          ),
        ),
    createPickerWindow(),
  ])
}

function showPickerWindow(): void {
  if (pickerWindow) {
    const displayBounds = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).bounds

    const displayEnd = {
      x: displayBounds.x + displayBounds.width,
      y: displayBounds.y + displayBounds.height,
    }

    const mousePoint = screen.getCursorScreenPoint()

    const bWindowBounds = pickerWindow.getBounds()

    const nudge = {
      x: -125,
      y: -30,
    }

    const inWindowPosition = {
      x:
        mousePoint.x + bWindowBounds.width + nudge.x > displayEnd.x
          ? displayEnd.x - bWindowBounds.width
          : mousePoint.x + nudge.x,
      y:
        mousePoint.y + bWindowBounds.height + nudge.y > displayEnd.y
          ? displayEnd.y - bWindowBounds.height
          : mousePoint.y + nudge.y,
    }

    pickerWindow.setPosition(inWindowPosition.x, inWindowPosition.y, false)

    // macOS drops these after fullscreen transitions; force the native
    // write by toggling off first (a same-value set can be a no-op)
    pickerWindow.setVisibleOnAllWorkspaces(false, {
      skipTransformProcessType: true,
    })
    pickerWindow.setAlwaysOnTop(true, 'screen-saver')
    pickerWindow.setVisibleOnAllWorkspaces(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    })

    debugLog(
      `show picker: visibleOnAllWorkspaces=${pickerWindow.isVisibleOnAllWorkspaces()}`,
    )

    pickerShownAt = Date.now()

    pickerWindow.show()
  } else {
    // Window is mid-recreation; retry once so the click isn't lost
    debugLog('show requested while picker recreating; retrying in 300ms')
    setTimeout(() => {
      if (pickerWindow) {
        showPickerWindow()
      }
    }, 300)
  }
}

function showPrefsWindow(): void {
  prefsWindow?.show()
}

export {
  createWindows,
  pickerWindow,
  prefsWindow,
  showPickerWindow,
  showPrefsWindow,
}
