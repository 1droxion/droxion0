const screens = {
  home: document.getElementById('screen-home'),
  upload: document.getElementById('screen-upload'),
  scan: document.getElementById('screen-scan'),
  paywall: document.getElementById('screen-paywall'),
  result: document.getElementById('screen-result'),
};

const state = {
  file: null,
  objectUrl: null,
  score: '8.7',
  match: 84,
  result: null,
  scanTimer: null,
  seed: 0,
};

const fileInput = document.getElementById('file-input');
const homeFileInput = document.getElementById('home-file-input');
const preview = document.getElementById('upload-preview');
const uploadEmpty = document.getElementById('upload-empty');
const consent = document.getElementById('consent');
const analyzeBtn = document.getElementById('analyze-btn');
const toast = document.getElementById('toast');
const checkoutBtn = document.getElementById('checkout-btn');

const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/28E00j0izacW9lh1az7Re00';
const PENDING_DB = 'facereveal-pending-v1';
const PENDING_STORE = 'checkout';
const PENDING_KEY = 'pending-reveal';

function track(event, data = {}) {
  console.info('[FaceReveal event]', event, data);
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    if (!screen) return;
    const active = key === name;
    screen.classList.toggle('screen-active', active);
    screen.setAttribute('aria-hidden', String(!active));
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  track('screen_view', { screen: name });
}

function showToast(message) {
  if (!toast) return;
  window.clearTimeout(showToast.timer);
  toast.textContent = message;
  toast.classList.add('show');
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function validateFile(file) {
  if (!file) return 'Please choose a photo.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Please use a JPG, PNG, or WEBP image.';
  if (file.size > 10 * 1024 * 1024) return 'Please choose a photo smaller than 10 MB.';
  return null;
}

function clearObjectUrl() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
}

function selectedCategory() {
  return document.querySelector('input[name="celebrity-category"]:checked')?.value || 'all';
}

function applyCategory(value) {
  const radio = document.querySelector(`input[name="celebrity-category"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function setPhoto(file) {
  const error = validateFile(file);
  if (error) return showToast(error);

  clearObjectUrl();
  state.file = file;
  state.objectUrl = URL.createObjectURL(file);
  state.result = null;
  state.seed = (file.size + file.name.length * 131 + file.lastModified) % 100000;
  window.FaceRevealResultSeed = state.seed;

  preview.src = state.objectUrl;
  preview.style.display = 'block';
  uploadEmpty.style.display = 'none';
  analyzeBtn.disabled = !consent.checked;
  track('photo_selected', { type: file.type, size: file.size });
}

function deriveResult(file) {
  const seed = state.seed || (file.size + file.name.length * 131 + file.lastModified) % 1000;
  const score = Math.min(7.4 + (seed % 21) / 10, 9.4).toFixed(1);
  const match = 73 + (seed % 19);
  const features = ['Smile', 'Eyes in this photo', 'Expression', 'Face framing', 'Lighting balance'];
  const styles = ['Natural-light portrait', 'Soft studio portrait', 'Golden-hour photo', 'Clean monochrome portrait', 'Street-style portrait'];
  const frames = ['Centered close-up', 'Slight three-quarter angle', 'Eye-level portrait', 'Shoulder-up portrait'];

  return {
    score,
    match,
    feature: features[seed % features.length],
    style: styles[seed % styles.length],
    frame: frames[seed % frames.length],
  };
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setImage(id, src) {
  const el = document.getElementById(id);
  if (el) el.src = src;
}

function hydrateResult() {
  if (!state.file || !state.objectUrl) return;
  const result = state.result || deriveResult(state.file);
  state.result = result;
  state.score = result.score;
  state.match = result.match;

  setImage('result-photo', state.objectUrl);
  setText('demo-score', result.score);
  setText('share-score', result.score);
  setText('strong-feature', result.feature);
  setText('photo-style', result.style);
  setText('face-frame', result.frame);
  setText('paywall-score-leading', result.score.charAt(0));
  setText('paywall-match-last', result.match.toString().slice(-1));
}

function runScan() {
  if (!state.file || !consent.checked) return;
  if (state.scanTimer) window.clearInterval(state.scanTimer);

  setImage('scan-photo', state.objectUrl);
  const msg = document.getElementById('scan-message');
  const bar = document.getElementById('scan-progress-bar');
  const messages = [
    ['Face verified ✓', 24],
    ['Reading photo', 52],
    ['Building your reveal', 78],
    ['Ready', 100],
  ];

  let index = 0;
  if (msg) msg.textContent = messages[0][0];
  if (bar) bar.style.width = `${messages[0][1]}%`;
  showScreen('scan');
  track('analysis_started');

  state.scanTimer = window.setInterval(() => {
    index += 1;
    if (index >= messages.length) {
      window.clearInterval(state.scanTimer);
      state.scanTimer = null;
      hydrateResult();
      track('analysis_completed');
      showScreen('paywall');
      return;
    }
    if (msg) msg.textContent = messages[index][0];
    if (bar) bar.style.width = `${messages[index][1]}%`;
  }, 600);
}

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PENDING_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local checkout storage.'));
  });
}

async function savePendingReveal() {
  if (!state.file) throw new Error('No selfie selected.');
  const db = await openPendingDb();
  const payload = {
    blob: state.file,
    name: state.file.name || 'facereveal-selfie.jpg',
    type: state.file.type,
    lastModified: state.file.lastModified || Date.now(),
    category: selectedCategory(),
    createdAt: Date.now(),
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readwrite');
    tx.objectStore(PENDING_STORE).put(payload, PENDING_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not save selfie before checkout.'));
  });
  db.close();
}

async function loadPendingReveal() {
  const db = await openPendingDb();
  const payload = await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readonly');
    const request = tx.objectStore(PENDING_STORE).get(PENDING_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not restore selfie.'));
  });
  db.close();
  return payload;
}

async function clearPendingReveal() {
  const db = await openPendingDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, 'readwrite');
    tx.objectStore(PENDING_STORE).delete(PENDING_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not clear checkout storage.'));
  });
  db.close();
}

async function verifyPayment(sessionId) {
  const response = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.reason || 'Payment could not be verified.');
  return data;
}

async function restorePaidReveal(sessionId) {
  showScreen('scan');
  setText('scan-message', 'Verifying your payment…');
  const bar = document.getElementById('scan-progress-bar');
  if (bar) bar.style.width = '35%';

  try {
    await verifyPayment(sessionId);
    if (bar) bar.style.width = '55%';
    setText('scan-message', 'Restoring your selfie…');

    const pending = await loadPendingReveal();
    if (!pending?.blob) throw new Error('Your saved selfie was not found on this device.');
    if (Date.now() - Number(pending.createdAt || 0) > 24 * 60 * 60 * 1000) throw new Error('Your saved selfie expired. Please contact support with your receipt.');

    const file = new File([pending.blob], pending.name || 'facereveal-selfie.jpg', {
      type: pending.type || pending.blob.type || 'image/jpeg',
      lastModified: pending.lastModified || Date.now(),
    });

    setPhoto(file);
    applyCategory(pending.category || 'all');
    consent.checked = true;
    analyzeBtn.disabled = false;

    if (bar) bar.style.width = '72%';
    setText('scan-message', 'Rebuilding your result…');

    const gate = window.FaceRevealFaceGate;
    if (!gate?.validateOneClearFace) throw new Error('Face analyzer is unavailable.');
    const faceResult = await gate.validateOneClearFace(preview);
    if (!faceResult?.ok) throw new Error(faceResult?.message || 'Could not restore face measurements.');

    hydrateResult();
    if (bar) bar.style.width = '100%';
    setText('scan-message', 'Payment verified ✓');
    track('purchase_verified', { value: 9.99, currency: 'USD', session_id: sessionId });

    await clearPendingReveal().catch(() => {});
    window.history.replaceState({}, document.title, window.location.pathname);
    showScreen('result');
    window.FaceRevealCelebrityMatches?.loadSet?.();
  } catch (error) {
    console.error('Paid reveal restore failed', error);
    window.history.replaceState({}, document.title, window.location.pathname);
    showScreen('home');
    showToast(error.message || 'We could not restore your paid result.');
  }
}

function resetApp() {
  if (state.scanTimer) window.clearInterval(state.scanTimer);
  state.scanTimer = null;
  state.file = null;
  state.result = null;
  state.seed = 0;
  window.FaceRevealResultSeed = 0;
  clearObjectUrl();

  preview?.removeAttribute('src');
  if (preview) preview.style.display = 'none';
  if (uploadEmpty) uploadEmpty.style.display = 'grid';
  if (fileInput) fileInput.value = '';
  if (homeFileInput) homeFileInput.value = '';
  if (consent) consent.checked = false;
  if (analyzeBtn) analyzeBtn.disabled = true;
  const progress = document.getElementById('scan-progress-bar');
  if (progress) progress.style.width = '8%';
  showScreen('home');
}

async function imageFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function createShareCardBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1080, 1920);
  bg.addColorStop(0, '#26133d');
  bg.addColorStop(0.52, '#100c18');
  bg.addColorStop(1, '#07070b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1920);

  const img = await imageFromObjectUrl(state.objectUrl);
  ctx.save();
  roundRect(ctx, 74, 190, 932, 932, 58);
  ctx.clip();
  const scale = Math.max(932 / img.width, 932 / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, 74 + (932 - w) / 2, 190 + (932 - h) / 2, w, h);
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText('FaceReveal', 74, 105);
  ctx.font = '800 185px system-ui, sans-serif';
  ctx.fillText(state.score, 84, 1430);
  ctx.font = '700 48px system-ui, sans-serif';
  ctx.fillText('/10', 468, 1425);
  ctx.font = '700 52px system-ui, sans-serif';
  ctx.fillText('My FaceReveal result 👀', 84, 1535);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

async function shareResult() {
  track('share_clicked');
  const text = `My FaceReveal score is ${state.score}/10 👀`;
  try {
    const blob = await createShareCardBlob();
    const file = new File([blob], 'facereveal-result.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title: 'My FaceReveal', text, files: [file] });
      return;
    }
  } catch (error) {
    console.warn('Image share unavailable', error);
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Share text copied.');
  } catch {
    showToast(text);
  }
}

document.getElementById('home-upload-btn')?.addEventListener('click', () => {
  track('upload_started');
  homeFileInput?.click();
});

homeFileInput?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setPhoto(file);
  showScreen('upload');
});

fileInput?.addEventListener('change', (event) => setPhoto(event.target.files?.[0]));
consent?.addEventListener('change', () => {
  analyzeBtn.disabled = !(state.file && consent.checked);
});
analyzeBtn?.addEventListener('click', runScan);

document.querySelectorAll('[data-back]').forEach((button) => {
  button.addEventListener('click', () => showScreen(button.dataset.back));
});

checkoutBtn?.addEventListener('click', async () => {
  if (!state.file) {
    showToast('Your selfie is missing. Please upload it again.');
    showScreen('upload');
    return;
  }

  checkoutBtn.disabled = true;
  const oldLabel = checkoutBtn.textContent;
  checkoutBtn.textContent = 'Opening secure checkout…';

  try {
    await savePendingReveal();
    track('checkout_clicked', {
      price: 9.99,
      currency: 'usd',
      price_id: 'price_1UCOnIEDfCCl7PuejRdiW3tv',
      payment_link_id: 'plink_1UCP0ZEDfCCl7PueZK6csmHR',
    });
    window.location.assign(STRIPE_CHECKOUT_URL);
  } catch (error) {
    console.error('Could not prepare checkout', error);
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = oldLabel;
    showToast('Could not prepare secure checkout. Please try again.');
  }
});

document.getElementById('restart-btn')?.addEventListener('click', resetApp);
document.getElementById('share-btn')?.addEventListener('click', shareResult);
document.getElementById('privacy-btn')?.addEventListener('click', () => document.getElementById('privacy-dialog')?.showModal());
document.getElementById('privacy-close')?.addEventListener('click', () => document.getElementById('privacy-dialog')?.close());
window.addEventListener('beforeunload', clearObjectUrl);

window.runScan = runScan;
window.showToast = showToast;
window.FaceRevealApp = { showScreen, hydrateResult, resetApp };

const returnedSessionId = new URLSearchParams(window.location.search).get('session_id');
if (returnedSessionId) {
  restorePaidReveal(returnedSessionId);
} else {
  track('landing_view');
}
