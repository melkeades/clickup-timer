const out = document.getElementById('out')
const btn = document.getElementById('toggle')

function show(r) {
  if (!r) return
  if (r.action === 'started') out.textContent = `✓ started: ${r.task_name || ''} (${r.task_id || ''})`
  else if (r.action === 'stopped') out.textContent = `✓ stopped: ${r.task_name || ''} (${r.task_id || ''})`
  else out.textContent = `✗ ${r.task_name || 'error'}`
}

btn.addEventListener('click', async () => {
  try {
    const r = await window.clickup.toggleTimer()
    show(r)
  } catch (e) {
    show({ action: 'error', task_name: String(e?.message || e) })
  }
})

window.clickup.onStatus(show)
