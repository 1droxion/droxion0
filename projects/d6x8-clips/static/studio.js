const isYouTube = raw => {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && ['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname)
  } catch { return false }
}
const byId = id => document.getElementById(id)
const form = byId('form')
const file = byId('file')
const url = byId('url')
const drop = byId('drop')
const caption = byId('captionToggle')
const text = byId('captionText')
const font = byId('captionFont')
const preview = byId('captionPreview')
const generate = byId('generate')
const results = byId('results')
const names = {bebasneue: 'Bebas', montserrat: 'Montserrat', poppins: 'Poppins', oswald: 'Oswald', anton: 'Anton'}
let selectedFile = null

function show(message, percent, error = false) {
  byId('status').hidden = false
  byId('message').textContent = message
  byId('message').classList.toggle('error', error)
  byId('bar').value = percent
}

function updateCaption() {
  byId('captionSettings').hidden = !caption.checked
  byId('captionMode').textContent = caption.checked ? 'Manual text on' : 'Off'
  preview.textContent = text.value.trim() || 'Your caption preview'
  preview.style.fontFamily = names[font.value] + ', sans-serif'
  preview.style.fontWeight = ['poppins', 'montserrat', 'oswald'].includes(font.value) ? '700' : '400'
}

function selectFile(next) {
  selectedFile = null
  byId('filename').textContent = 'Upload Your Gameplay'
  if (!next) return
  if (!/\.(mp4|mov|mkv|webm|m4v)$/i.test(next.name) || !next.size || next.size > 850 * 1024 * 1024) {
    file.value = ''
    show('Choose an MP4, MOV, MKV, WebM or M4V video up to 850 MB.', 0, true)
    return
  }
  selectedFile = next
  byId('filename').textContent = next.name
  byId('status').hidden = true
  if (!isYouTube(url.value.trim())) { url.value = ''; byId('linkOptions').open = false }
}

file.addEventListener('change', () => selectFile(file.files[0]))
url.addEventListener('input', () => {
  if (url.value.trim() && !isYouTube(url.value.trim())) {
    file.value = ''
    selectFile(null)
  }
})
drop.addEventListener('dragover', event => {
  event.preventDefault()
  drop.classList.add('drag-over')
})
drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'))
drop.addEventListener('drop', event => {
  event.preventDefault()
  drop.classList.remove('drag-over')
  file.value = ''
  selectFile(event.dataTransfer.files[0])
})
for (const control of [caption, text, font]) control.addEventListener('input', updateCaption)
updateCaption()

const menu = byId('menu')
const nav = byId('nav')
function openMenu(open) {
  nav.classList.toggle('open', open)
  menu.setAttribute('aria-expanded', String(open))
}
menu.addEventListener('click', () => openMenu(menu.getAttribute('aria-expanded') !== 'true'))
nav.addEventListener('click', event => { if (event.target.closest('a')) openMenu(false) })
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    openMenu(false)
    menu.focus()
  }
})

function showClips(clips) {
  for (const clip of clips) {
    const card = document.createElement('article')
    card.className = 'clip'
    const video = document.createElement('video')
    video.src = clip.url
    video.controls = true
    video.preload = 'metadata'
    video.playsInline = true
    const number = String(clip.number).padStart(2, '0')
    const label = document.createElement('strong')
    label.textContent = 'Highlight ' + number
    video.setAttribute('aria-label', label.textContent)
    const time = document.createElement('small')
    time.textContent = Math.round(clip.start) + 's – ' + Math.round(clip.end) + 's'
    const download = document.createElement('a')
    download.href = clip.url + '?download=true'
    download.download = 'DroxionClips_' + number + '.mp4'
    download.textContent = 'Download MP4'
    card.append(video, label, time, download)
    results.append(card)
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  const link = url.value.trim()
  if (!selectedFile && !link) return show('Upload gameplay or enter a direct video link.', 0, true)
  if (isYouTube(link) && !selectedFile) return show('YouTube link recognized. Upload your own original recording too; YouTube video download is not supported.', 0, true)
  if (caption.checked && !text.value.trim()) return show('Enter a caption or switch captions off.', 0, true)

  const body = new FormData()
  if (selectedFile) body.append('video', selectedFile)
  if (link && (!selectedFile || isYouTube(link))) body.append('url', link)
  body.append('template', byId('template').value)
  body.append('captions', String(caption.checked))
  body.append('caption_font', font.value)
  body.append('caption_text', caption.checked ? text.value.trim() : '')
  generate.disabled = true
  show('Submitting video…', 4)
  try {
    const response = await fetch('/api/jobs', {method: 'POST', body})
    const data = await response.json()
    if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'Could not start processing.')
    results.replaceChildren()
    for (let attempt = 0; attempt < 1500; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1200))
      const response = await fetch('/api/jobs/' + encodeURIComponent(data.job_id))
      if (!response.ok) throw Error('Could not track this job.')
      const job = await response.json()
      if (job.status === 'error') throw Error(job.message)
      show(job.message, job.progress)
      if (job.status === 'done') {
        showClips(job.clips)
        return
      }
    }
    throw Error('Processing is taking longer than expected. Check your local server.')
  } catch (error) {
    show(error.message || 'Something went wrong.', 0, true)
  } finally {
    generate.disabled = false
  }
})

const obsStart = byId('obsStart')
const obsStop = byId('obsStop')
const obsState = byId('obsState')
const obsMessage = byId('obsMessage')
const obsView = byId('obsView')
let lastOBSJob = null
async function readOBSStatus() {
  try {
    const response = await fetch('/api/obs/status')
    if (!response.ok) return
    const data = await response.json()
    obsState.textContent = data.watching ? 'Watching OBS folder' : 'Not watching'
    obsState.classList.toggle('active', data.watching)
    obsMessage.textContent = data.last_error
      ? data.last_error
      : data.watching
        ? 'Monitoring new completed recordings. ' + data.processed_count + ' file(s) queued.'
        : 'OBS monitoring is stopped. Existing clips remain available until their cleanup time.'
    if (data.last_job && data.last_job !== lastOBSJob) {
      lastOBSJob = data.last_job
      obsView.hidden = false
      obsMessage.textContent = 'New OBS recording queued. Job: ' + data.last_job + '. Check the results using your clips dashboard.'
    }
  } catch { obsMessage.textContent = 'Could not read OBS watcher status.' }
}
obsStart.addEventListener('click', async () => {
  const directory = byId('obsFolder').value.trim()
  if (!directory) { obsMessage.textContent = 'Enter your OBS recording folder path first.'; return }
  obsStart.disabled = true
  try {
    const response = await fetch('/api/obs/start', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        directory,
        source_url: isYouTube(url.value.trim()) ? url.value.trim() : '',
        template:byId('template').value,
        captions:caption.checked,
        caption_text:caption.checked ? text.value.trim() : '',
        caption_font:font.value
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.detail || 'Could not start watcher.')
    obsMessage.textContent = 'Watching ' + data.directory + '. Save a new OBS replay or completed recording.'
  } catch (error) { obsMessage.textContent = error.message }
  finally { obsStart.disabled = false; readOBSStatus() }
})
obsStop.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/obs/stop', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
    if (!response.ok) throw new Error('Could not stop OBS monitoring.')
    obsMessage.textContent = 'OBS monitoring stopped.'
    readOBSStatus()
  } catch (error) { obsMessage.textContent = error.message }
})
setInterval(readOBSStatus, 4500)
readOBSStatus()

obsView.addEventListener('click', async () => {
  if (!lastOBSJob) return
  results.replaceChildren()
  const update = async () => {
    const response = await fetch('/api/jobs/' + encodeURIComponent(lastOBSJob))
    if (!response.ok) throw new Error('Latest OBS clips are no longer available.')
    const data = await response.json()
    if (data.status === 'error') throw new Error(data.message || 'Could not render OBS clips.')
    if (data.status === 'done') {
      show('Five OBS highlights ready.', 100)
      showClips(data.clips)
      byId('studio').scrollIntoView({behavior:'smooth'})
      return true
    }
    show(data.message || 'Processing OBS footage…', data.progress || 5)
    byId('studio').scrollIntoView({behavior:'smooth'})
    return false
  }
  try {
    for (let i = 0; i < 180; i++) {
      if (await update()) return
      await new Promise(resolve => setTimeout(resolve, 1200))
    }
    throw new Error('OBS processing is taking longer than expected.')
  } catch (error) { obsMessage.textContent = error.message }
})
