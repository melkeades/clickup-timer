const { app, BrowserWindow, ipcMain, globalShortcut, Tray, nativeImage } = require('electron/main')
const path = require('node:path')

let tray

function img(p) {
  // NativeImage can be created from a path (png/jpg/etc). :contentReference[oaicite:3]{index=3}
  return nativeImage.createFromPath(p)
}

// Put these files somewhere you ship with the app, e.g. ./assets/
const ICON_IDLE_32 = path.join(__dirname, 'assets', 'norm.png')
const ICON_RUN_32 = path.join(__dirname, 'assets', 'act.png')
const OVERLAY_IDLE_16 = path.join(__dirname, 'assets', 'norm.png')
const OVERLAY_RUN_16 = path.join(__dirname, 'assets', 'act.png')

function ensureTray() {
  if (tray) return
  tray = new Tray(ICON_IDLE_32)
}

function setTimerIndicators({ running }, win) {
  ensureTray()

  // 1) Tray icon (cross-platform)
  // tray.setImage(image) updates the tray icon. :contentReference[oaicite:4]{index=4}
  tray.setImage(running ? ICON_RUN_32 : ICON_IDLE_32)

  // 2) Windows taskbar overlay badge (Windows only)
  // win.setOverlayIcon(overlay, description) :contentReference[oaicite:5]{index=5}
  if (process.platform === 'win32' && win) {
    const overlay = running ? img(OVERLAY_RUN_16) : null // null clears overlay :contentReference[oaicite:6]{index=6}
    win.setOverlayIcon(overlay, running ? 'Timer running' : 'Timer stopped')
  }

  // 3) macOS Dock icon (macOS only)
  // app.dock.setIcon(image) :contentReference[oaicite:7]{index=7}
  if (process.platform === 'darwin') {
    app.dock.setIcon(running ? ICON_RUN_32 : ICON_IDLE_32)
  }
}

const BASE = 'https://api.clickup.com/api/v2'

function mustEnv(name) {
  const v = (process.env[name] || '').trim()
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

async function clickupFetch(method, url, body) {
  const token = mustEnv('CLICKUP_TOKEN') // ClickUp: Authorization: {personal_token}

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: token,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* leave json null */
  }

  if (!res.ok) {
    const msg = json ? JSON.stringify(json) : text
    throw new Error(`HTTP ${res.status} ${method} ${url}\n${msg}`)
  }
  return json
}

function parseStartMs(entry) {
  const v = entry?.start
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  return 0
}

function taskId(entry) {
  const tid = entry?.task?.id
  return typeof tid === 'string' && tid.trim() ? tid.trim() : null
}

function taskName(entry) {
  const name = entry?.task?.name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

async function toggleClickupTimer() {
  const teamId = mustEnv('CLICKUP_TEAM_ID')

  // 1) Is something currently tracking?
  // GET /team/{team_id}/time_entries/current
  const current = await clickupFetch('GET', `${BASE}/team/${teamId}/time_entries/current`)
  const running = current?.data?.id != null

  if (running) {
    // 2a) Stop timer
    // POST /team/{team_id}/time_entries/stop
    const stopped = await clickupFetch('POST', `${BASE}/team/${teamId}/time_entries/stop`)

    return {
      action: 'stopped',
      task_id: taskId(stopped?.data) ?? null,
      task_name: taskName(stopped?.data) ?? null,
    }
  }

  // 2b) Nothing running → pick last task-backed time entry and start it
  // GET /team/{team_id}/time_entries (defaults to last 30 days for auth user)
  const now = Date.now()
  const start30d = now - 30 * 24 * 60 * 60 * 1000

  const list = await clickupFetch('GET', `${BASE}/team/${teamId}/time_entries?start_date=${start30d}&end_date=${now}`)

  const entries = Array.isArray(list?.data) ? list.data : []
  const candidates = entries.filter((e) => taskId(e))

  if (!candidates.length) {
    return { action: 'error', task_id: null, task_name: 'No recent task-backed time entries found' }
  }

  candidates.sort((a, b) => parseStartMs(b) - parseStartMs(a))
  const last = candidates[0]
  const tid = taskId(last)

  // POST /team/{team_id}/time_entries/start with {"tid": "<task_id>"}
  const started = await clickupFetch('POST', `${BASE}/team/${teamId}/time_entries/start`, { tid })

  return {
    action: 'started',
    task_id: taskId(started?.data) ?? tid,
    task_name: taskName(started?.data) ?? taskName(last) ?? null,
  }
}

let win

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 220,
    icon: ICON_IDLE_32,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  // Initialize tray on startup
  ensureTray()
  setTimerIndicators({ running: false }, win)

  // IPC handler (renderer -> main)
  ipcMain.handle('clickup:toggleTimer', async () => {
    return await toggleClickupTimer()
  })

  // Global hotkey (main process)
  const ok = globalShortcut.register('CommandOrControl+Shift+Alt+t', async () => {
    try {
      const r = await toggleClickupTimer()
      setTimerIndicators({ running: r.action === 'started' }, win)
      win?.webContents?.send('clickup:status', r)
    } catch (e) {
      win?.webContents?.send('clickup:status', { action: 'error', task_name: String(e?.message || e) })
    }
  })

  if (!ok) {
    win?.webContents?.send('clickup:status', { action: 'error', task_name: 'globalShortcut.register failed' })
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
