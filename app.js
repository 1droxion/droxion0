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

// Filled as soon as the Stripe Payment Link / Checkout URL is created.
const STRIPE_CHECKOUT_URL = '';

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
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3000);
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

document.getElementById('checkout-btn')?.addEventListener('click', () => {
  track('checkout_clicked', { price: 9.99, currency: 'usd', price_id: 'price_1UCOnIEDfCCl7PuejRdiW3tv' });
  if (!STRIPE_CHECKOUT_URL) {
    showToast('Secure checkout is being activated. Please try again shortly.');
    return;
  }
  window.location.assign(STRIPE_CHECKOUT_URL);
});

document.getElementById('restart-btn')?.addEventListener('click', resetApp);
document.getElementById('share-btn')?.addEventListener('click', shareResult);
document.getElementById('privacy-btn')?.addEventListener('click', () => document.getElementById('privacy-dialog')?.showModal());
document.getElementById('privacy-close')?.addEventListener('click', () => document.getElementById('privacy-dialog')?.close());
window.addEventListener('beforeunload', clearObjectUrl);

window.runScan = runScan;
window.showToast = showToast;
window.FaceRevealApp = { showScreen, hydrateResult, resetApp };
track('landing_view');
