const slug = document.body.dataset.product
const capture = search => Object.fromEntries(['source','medium','campaign','content','term'].map(key => [key,search.get('utm_'+key)||'']))
const privacyOptOut = navigator.globalPrivacyControl || navigator.doNotTrack === '1'
let attribution = {campaign:capture(new URLSearchParams(location.search)), referrer:document.referrer}
if (!privacyOptOut) {
  try {
    const last = JSON.parse(sessionStorage.getItem('droxion-attribution') || 'null')
    const external = document.referrer && new URL(document.referrer).origin !== location.origin
    if (last && !external && !Object.values(attribution.campaign).some(Boolean)) attribution = last
    sessionStorage.setItem('droxion-attribution',JSON.stringify(attribution))
  } catch {}
}
function track(kind, product='') {
  if (privacyOptOut || document.body.dataset.public !== 'true') return
  fetch('/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,slug:product,...attribution}),keepalive:true}).catch(()=>{})
}
if (slug) track('view',slug)
else if (location.pathname === '/') track('home')
document.addEventListener('click', event=>{
  const link = event.target.closest('[data-interest],[data-notify]')
  if (link) track(link.dataset.notify?'notify':'interest',link.dataset.notify||link.dataset.interest)
  if (event.target.closest('[data-zoom]')) document.querySelector('.zoom').showModal()
})
document.querySelectorAll('.signup').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault()
  const feedback = form.querySelector('.feedback')
  const submit = form.querySelector('button')
  submit.disabled = true
  try {
    const response = await fetch(form.action,{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(new FormData(form))})
    const result = await response.json()
    feedback.textContent = result.message
    if (response.ok) form.querySelector('input[type=email]').value=''
  } catch {
    feedback.textContent = 'Could not submit right now. Please try again.'
  } finally {
    submit.disabled = false
  }
}))
document.querySelectorAll('[data-upload]').forEach(input=>input.addEventListener('change',async()=>{
  const file=input.files[0]
  if (!file) return
  const form=input.form
  const feedback=form.querySelector('.feedback')
  const submit=form.querySelector('button')
  submit.disabled=true
  try {
    const response=await fetch('/admin/image',{method:'POST',body:file,headers:{'Content-Type':'image/webp','X-CSRF-Token':form.elements.csrf.value}})
    if (!response.ok) throw new Error('Upload failed')
    form.elements.customImage.value=(await response.json()).id
    feedback.textContent='Image uploaded. Save the product to apply it.'
  } catch {
    feedback.textContent='Upload failed. Choose a WebP image no larger than 1 MB.'
  } finally {
    submit.disabled=false
  }
}))
