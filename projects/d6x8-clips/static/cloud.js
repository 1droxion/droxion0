/* Real DroxionClips Web Beta studio: upload, direct media URL, five previews,
   captions, font styles, and selection-based ZIP. No YouTube scraping. */
const $ = id => document.getElementById(id)
const file = $('file'), url = $('url'), drop = $('drop')
const caption = $('captionToggle'), captionText = $('captionText'), font = $('captionFont')
const captionSettings = $('captionSettings'), captionMode = $('captionMode')
const clipCount = $('clipCount'), captionColor = $('captionColor')
const editMode = $('editMode'), autoTemplate = $('autoTemplate')
function updateMode() {
  const automatic = editMode.value === 'auto'
  $('autoTemplateField').hidden = !automatic
  $('clipCountField').hidden = automatic
  generate.textContent = automatic ? 'Auto Edit Video →' : 'Create Clips →'
}
editMode.addEventListener('change',updateMode)
const preview = $('captionPreview'), form = $('form'), generate = $('generate')
const results = $('results'), status = $('status'), message = $('message'), bar = $('bar')
const mobileMenu = $('menu'), nav = $('nav')
const publicEditor = document.body.dataset.publicEditor === 'true'
const jobsBase = publicEditor ? '/api/public/jobs' : '/api/jobs'
const uploadMax = publicEditor ? 1024**3 : 120*1024*1024
let selectedFile = null, latestJob = null, currentClips = []
const fonts = {bebasneue:'Bebas', montserrat:'Montserrat', poppins:'Poppins',
               oswald:'Oswald', anton:'Anton'}
const selectFile = chosen => {
  selectedFile = chosen || null
  $('filename').textContent = selectedFile ? selectedFile.name : 'Upload Your Gameplay'
  if (selectedFile && selectedFile.size > uploadMax) {
    show('The selected video exceeds the editor upload limit.',0,true)
  }
}
function updateCaption() {
  captionSettings.hidden = !caption.checked
  captionMode.textContent = caption.checked ? 'On' : 'Off'
  preview.textContent = captionText.value.trim() || 'YOUR CAPTION'
  preview.style.fontFamily = fonts[font.value] || 'Arial'
  preview.style.color = captionColor.value
  captionText.required = caption.checked
}
function isYouTube(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.replace(/^(www\.|m\.)/, '')
    if (host === 'youtu.be') return /^\/[a-zA-Z0-9_-]{11}\/?$/.test(u.pathname)
    if (host !== 'youtube.com') return false
    return u.pathname === '/watch' ? /^[A-Za-z0-9_-]{11}$/.test(u.searchParams.get('v')||'')
      : /^\/(shorts|live)\/[a-zA-Z0-9_-]{11}\/?$/.test(u.pathname)
  } catch { return false }
}
function show(text,percent,error=false) {
  status.hidden = false
  message.textContent = text
  message.classList.toggle('error',error)
  bar.value = Math.max(0,Math.min(100,percent||0))
}
function safeOpen(url,download=false) {
  const a = document.createElement('a')
  a.href = url
  if (download) a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}
function clearResults() {
  currentClips = []
  results.replaceChildren()
  $('selectedTools')?.remove()
}
function showClips(clips) {
  clearResults()
  if (clips.length !== (editMode.value === 'auto' ? 1 : Number(clipCount.value))) {show('The processing job did not produce the requested number of clips.',0,true);return}
  currentClips = clips
  const tools = document.createElement('section')
  tools.id = 'selectedTools'
  tools.className = 'selected-tools'
  const heading = document.createElement('div')
  heading.innerHTML = editMode.value === 'auto'
    ? '<strong>Your auto-edited video</strong><p>One reel assembled from selected moments. Preview or download below.</p>'
    : '<strong>Choose your clips</strong><p>Preview and download your highlights.</p>'
  const all = document.createElement('button')
  all.type='button'; all.textContent='Select all'; all.className='all-select'
  const bundle = document.createElement('button')
  bundle.type='button'; bundle.textContent='Download selected ZIP'; bundle.className='cta'
  const count = document.createElement('span');count.className='selection-count'
  const checks=[]
  function sync() {
    const nums=checks.filter(c=>c.checked).map(c=>c.value)
    count.textContent=nums.length+' of '+clips.length+' selected'
    bundle.disabled=nums.length===0
  }
  all.addEventListener('click',()=>{checks.forEach(c=>c.checked=true);sync()})
  bundle.addEventListener('click',()=>{
    const nums=checks.filter(c=>c.checked).map(c=>c.value)
    if(!latestJob||!nums.length)return
    safeOpen(jobsBase+'/'+encodeURIComponent(latestJob)+'/selected.zip?clips='+nums.join(','),true)
  })
  tools.append(heading,all,bundle,count)
  results.before(tools)
  for (const clip of clips) {
    const card=document.createElement('article');card.className='clip'
    const video=document.createElement('video')
    video.src=clip.url;video.controls=true;video.playsInline=true;video.preload='metadata'
    video.setAttribute('aria-label','Preview clip '+clip.number)
    const title=document.createElement('strong');title.textContent='Clip '+clip.number
    const times=document.createElement('small')
    times.textContent=Math.round(clip.start)+'s to '+Math.round(clip.end)+'s'
    const checkWrap=document.createElement('label');checkWrap.className='clip-choice'
    const check=document.createElement('input');check.type='checkbox';check.value=String(clip.number);check.checked=true
    check.addEventListener('change',sync)
    checks.push(check)
    checkWrap.append(check,document.createTextNode(' Select clip '+clip.number))
    const download=document.createElement('a');download.textContent='Download MP4'
    download.href=clip.url+'?download=true'
    download.download='DroxionClips_'+String(clip.number).padStart(2,'0')+'.mp4'
    card.append(video,title,times,checkWrap,download)
    results.appendChild(card)
  }
  sync()
}
file.addEventListener('change',()=>{
  selectFile(file.files[0])
  if(selectedFile)url.value=''
})
url.addEventListener('input',()=>{
  // A YouTube reference may accompany an uploaded recording; direct MP4 is standalone.
  if(url.value.trim()) {
    selectedFile=null;file.value='';selectFile(null)
  }
})
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag-over')})
drop.addEventListener('dragleave',()=>drop.classList.remove('drag-over'))
drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('drag-over')
  if(!e.dataTransfer.files.length)return
  file.value='';selectFile(e.dataTransfer.files[0])
})
for(const control of [caption,captionText,font,captionColor])control.addEventListener('input',updateCaption)
updateCaption()
if(mobileMenu&&nav){
  mobileMenu.addEventListener('click',()=>{
    const open=mobileMenu.getAttribute('aria-expanded')!=='true'
    mobileMenu.setAttribute('aria-expanded',String(open))
    nav.classList.toggle('open',open)
  })
  nav.addEventListener('click',e=>{if(e.target.closest('a')){mobileMenu.setAttribute('aria-expanded','false');nav.classList.remove('open')}})
}
form.addEventListener('submit',async e=>{
  e.preventDefault()
  const link=url.value.trim()
  if(!selectedFile&&!link){show('Upload your gameplay file or enter a supported direct media URL.',0,true);return}
  if(selectedFile&&selectedFile.size>uploadMax){show('The file exceeds the editor upload limit.',0,true);return}
  if(caption.checked&&!captionText.value.trim()){show('Enter your caption or turn captions off.',0,true);return}
  if(!$('rights').checked){show('Confirm you own or have permission to process this recording.',0,true);return}
  clearResults();generate.disabled=true
  show('Preparing video…',3)
  try{
    const body=new FormData()
    if(selectedFile)body.append('video',selectedFile)
    if(link)body.append('url',link)
    body.append('template',$('template').value)
    body.append('captions',String(caption.checked))
    body.append('caption_text',caption.checked?captionText.value.trim():'')
    body.append('caption_font',font.value)
    body.append('caption_color',captionColor.value)
    body.append('clip_count',clipCount.value)
    body.append('mode',editMode.value)
    body.append('auto_template',autoTemplate.value)
    body.append('rights','true')
    const response=await fetch(jobsBase,{method:'POST',body,credentials:'same-origin'})
    const data=await response.json()
    if(!response.ok)throw Error(data.detail||'Unable to submit video')
    latestJob=data.job_id
    for(let attempt=0;attempt<420;attempt++){
      await new Promise(resolve=>setTimeout(resolve,1500))
      const statusResponse=await fetch(jobsBase+'/'+encodeURIComponent(latestJob),{credentials:'same-origin'})
      if(statusResponse.status===401)throw Error('Your beta session expired. Refresh and log in.')
      if(!statusResponse.ok)throw Error('Unable to check processing status.')
      const state=await statusResponse.json()
      show(state.message||'Processing…',state.progress||0)
      if(state.status==='error')throw Error(state.message||'Video rendering failed')
      if(state.status==='done'){showClips(state.clips);show(editMode.value === 'auto' ? 'Auto-edited video ready!' : state.clips.length+' clips ready!',100);return}
    }
    throw Error('Processing is taking longer than expected. Try a shorter video.')
  }catch(error){show(error.message||'An error occurred.',0,true)}
  finally{generate.disabled=false}
})

updateMode()
