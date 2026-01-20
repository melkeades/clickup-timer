const taskListEl = document.getElementById('task-list')
const statusEl = document.getElementById('status')
const refreshTimerEl = document.getElementById('refresh-timer')
const uniqueToggle = document.getElementById('unique-toggle')
const searchInput = document.getElementById('search-input')

let entries = []
let currentTaskId = null
let refreshInterval = null
let countdownInterval = null
let nextRefresh = 0
let hideDailyDuplicates = false
let searchText = ''

const REFRESH_MS = 3 * 60 * 1000 // 3 minutes

// Toggle handler
uniqueToggle.addEventListener('click', () => {
  hideDailyDuplicates = !hideDailyDuplicates
  uniqueToggle.classList.toggle('active', hideDailyDuplicates)
  renderTasks()
})

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchText = e.target.value.trim().toLowerCase()
    renderTasks()
  })
}

function formatTime(ms) {
  if (!ms) return '--:--'
  const date = new Date(ms)
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '--:--:--'
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDurationShort(ms) {
  if (!ms || ms < 0) return '0h 0m'
  const totalMin = Math.floor(ms / 60000)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  return `${hours}h ${minutes}m`
}

function formatCountdown(ms) {
  if (ms <= 0) return 'now'
  const sec = Math.ceil(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = sec % 60
  return min > 0 ? `${min}m ${s}s` : `${s}s`
}

function getPSTDateString(ms) {
  if (!ms) return ''
  const date = new Date(ms)
  // Format in PST (America/Los_Angeles)
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function updateCountdown() {
  const remaining = nextRefresh - Date.now()
  refreshTimerEl.textContent = `Refresh in ${formatCountdown(remaining)}`
}

function renderTasks() {
  if (!entries.length) {
    taskListEl.innerHTML = '<div class="loading">No time entries found</div>'
    return
  }

  // Calculate total duration per day from ALL entries (not filtered)
  const dayTotals = new Map()
  entries.forEach((entry) => {
    const day = getPSTDateString(entry.startMs)
    const current = dayTotals.get(day) || 0
    dayTotals.set(day, current + (entry.duration || 0))
  })

  // Filter by search text
  let displayEntries = entries
  if (searchText) {
    displayEntries = displayEntries.filter((entry) => {
      const name = (entry.task_name || '').toLowerCase()
      return name.includes(searchText)
    })
  }

  // Filter to unique tasks per day if toggle is on
  if (hideDailyDuplicates) {
    const seenPerDay = new Map() // day -> Set of task_ids
    displayEntries = displayEntries.filter((entry) => {
      const day = getPSTDateString(entry.startMs)
      if (!seenPerDay.has(day)) {
        seenPerDay.set(day, new Set())
      }
      const daySet = seenPerDay.get(day)
      if (daySet.has(entry.task_id)) {
        return false // duplicate for this day
      }
      daySet.add(entry.task_id)
      return true
    })
  }

  let lastDay = null
  let html = ''

  displayEntries.forEach((entry) => {
    const entryDay = getPSTDateString(entry.startMs)

    // Add day separator if day changed
    if (entryDay && entryDay !== lastDay) {
      const dayTotal = formatDurationShort(dayTotals.get(entryDay))
      html += `<div class="day-separator"><span class="day-label">${entryDay} - ${dayTotal}</span></div>`
      lastDay = entryDay
    }

    const isRunning = entry.isRunning || entry.task_id === currentTaskId
    const btnClass = isRunning ? 'stop' : 'start'
    const btnIcon = isRunning ? '⏹' : '▶'
    const itemClass = isRunning ? 'task-item running' : 'task-item'

    const startTime = formatTime(entry.startMs)
    const endTime = entry.isRunning ? 'running' : formatTime(entry.endMs)
    const lasted = entry.isRunning ? 'tracking...' : formatDuration(entry.duration)
    const billableIndicator = entry.billable ? '<span class="billable-badge">$</span>' : ''

    html += `
      <div class="${itemClass}" data-task-id="${entry.task_id}" data-entry-id="${entry.entry_id}">
        <button class="task-btn ${btnClass}" data-task-id="${entry.task_id}" data-running="${isRunning}">
          ${btnIcon}
        </button>
        <div class="task-content">
          <div class="task-name" title="${entry.task_name || 'Unknown task'}">${entry.task_name || 'Unknown task'}${billableIndicator}</div>
          <div class="task-time">
            ${startTime} → ${endTime} • ${lasted}
          </div>
        </div>
        <button class="task-delete" data-entry-id="${entry.entry_id}" title="Delete entry">✕</button>
      </div>
    `
  })

  taskListEl.innerHTML = html

  // Attach click handlers
  taskListEl.querySelectorAll('.task-btn').forEach((btn) => {
    btn.addEventListener('click', handleTaskClick)
  })

  // Attach copy handlers to task content
  taskListEl.querySelectorAll('.task-content').forEach((content) => {
    content.addEventListener('click', handleCopyTaskUrl)
  })

  // Attach delete handlers
  taskListEl.querySelectorAll('.task-delete').forEach((btn) => {
    btn.addEventListener('click', handleDeleteEntry)
  })
}

async function handleDeleteEntry(e) {
  const btn = e.currentTarget
  const entryId = btn.dataset.entryId
  if (!entryId) return

  btn.disabled = true
  btn.textContent = '...'

  try {
    await window.clickup.deleteEntry(entryId)
    await refreshEntries()
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`
    statusEl.style.color = '#D0BCFF'
  }
}

async function handleCopyTaskUrl(e) {
  const taskItem = e.currentTarget.closest('.task-item')
  const taskId = taskItem?.dataset?.taskId
  if (!taskId) return

  const url = `https://app.clickup.com/t/${taskId}`

  try {
    await navigator.clipboard.writeText(url)
    // Show copied feedback
    taskItem.classList.add('copied')
    setTimeout(() => taskItem.classList.remove('copied'), 1500)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

async function handleTaskClick(e) {
  const btn = e.currentTarget
  const taskId = btn.dataset.taskId
  const isRunning = btn.dataset.running === 'true'

  btn.disabled = true
  btn.textContent = '...'

  try {
    if (isRunning) {
      await window.clickup.stopTimer()
      currentTaskId = null
    } else {
      await window.clickup.startTask(taskId)
      currentTaskId = taskId
    }
    await refreshEntries()
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`
    statusEl.style.color = '#D0BCFF'
  }
}

async function refreshEntries() {
  try {
    statusEl.textContent = 'Refreshing...'
    statusEl.style.color = '#CAC4D0'

    const [entriesData, currentEntry] = await Promise.all([window.clickup.getEntries(), window.clickup.getCurrentEntry()])

    entries = entriesData || []
    currentTaskId = currentEntry?.task_id || null

    // Mark current entry as running
    entries.forEach((e) => {
      if (e.task_id === currentTaskId) {
        e.isRunning = true
      }
    })

    renderTasks()

    // Update tray/taskbar indicators based on current state
    await window.clickup.updateIndicators(!!currentTaskId)

    if (currentTaskId) {
      const current = entries.find((e) => e.task_id === currentTaskId)
      const taskName = current?.task_name || currentEntry?.task_name || 'Unknown task'
      statusEl.innerHTML = `<span class="current"><button class="status-stop-btn" id="status-stop-btn" title="Stop timer">⏹</button>${taskName}</span>`

      // Attach click handler to status stop button
      const statusStopBtn = document.getElementById('status-stop-btn')
      if (statusStopBtn) {
        statusStopBtn.addEventListener('click', async () => {
          statusStopBtn.disabled = true
          statusStopBtn.textContent = '...'
          try {
            await window.clickup.stopTimer()
            currentTaskId = null
            await refreshEntries()
          } catch (err) {
            statusEl.textContent = `Error: ${err.message}`
            statusEl.style.color = '#D0BCFF'
          }
        })
      }
    } else {
      statusEl.textContent = 'No timer running'
    }
    statusEl.style.color = ''

    // Reset refresh timer
    nextRefresh = Date.now() + REFRESH_MS
  } catch (err) {
    taskListEl.innerHTML = `<div class="error">Error: ${err.message}</div>`
    statusEl.textContent = 'Error loading entries'
    statusEl.style.color = '#D0BCFF'
  }
}

// Handle status updates from global hotkey
window.clickup.onStatus(async (r) => {
  if (r.action === 'started') {
    currentTaskId = r.task_id
  } else if (r.action === 'stopped') {
    currentTaskId = null
  }
  await refreshEntries()
})

// Initial load
refreshEntries()

// Auto-refresh every 3 minutes
refreshInterval = setInterval(refreshEntries, REFRESH_MS)

// Update countdown every second
countdownInterval = setInterval(updateCountdown, 1000)
nextRefresh = Date.now() + REFRESH_MS
