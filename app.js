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
};

const fileInput = document.getElementById('file-input');
const homeFileInput = document.getElementById('home-file-input');
const preview = document.getElementById('upload-preview');
const uploadEmpty = document.getElementById('upload-empty');
const consent = document.getElementById('consent');
const analyzeBtn = document.getElementById('analyze-btn');
const toast = document.getElementById('toast');
const demoBanner = document.getElementById('demo-banner');

function track(event, data = {}) {
  console.info('[FaceReveal event]', event, data);
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    const active = key === name;
    screen.classList.toggle('screen-active', active);
    screen.setAttribute('aria-hidden', String(!active));
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  track('screen_view', { screen: name });
}

function showToast(message) {
  window.clearTimeout(showToast.timer);
  toast.textContent = message;
  toast.classList.add('show');
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function validateFile(file) {
  if (!file) return 'Please choose a photo.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return 'Please use a JPG, PNG, or WEBP image.';
  }
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

  preview.src = state.objectUrl;
  preview.style.display = 'block';
  uploadEmpty.style.display = 'none';
  analyzeBtn.disabled = !consent.checked;
  track('photo_selected', { type: file.type, size: file.size });
}

function deriveDemoResult(file) {
  const seed = (file.size + file.name.length * 131 + file.lastModified) % 1000;
  const score = Math.min(7.4 + (seed % 21) / 10, 9.4).toFixed(1);
  const match = 73 + (seed % 19);
  const features = ['Smile', 'Eyes in this photo', 'Expression', 'Face framing', 'Lighting balance'];
  const styles = ['Natural-light portrait', 'Soft studio portrait', 'Golden-hour photo', 'Clean monochrome portrait', 'Street-style portrait'];
  const frames = ['Centered close-up', 'Slight three-quarter angle', 'Eye-level portrait', 'Shoulder-up portrait'];
  const archetypes = ['Hollywood Lead', 'Pop-Star Energy', 'Editorial Model', 'Rom-Com Lead', 'Action-Hero Vibe'];

  return {
    score,
    match,
    feature: features[seed % features.length],
    style: styles[seed % styles.length],
    frame: frames[seed % frames.length],
    archetype: archetypes[seed % archetypes.length],
  };
}

function hydrateResult() {
  if (!state.file || !state.objectUrl) return;
  const result = state.result || deriveDemoResult(state.file);
  state.result = result;
  state.score = result.score;
  state.match = result.match;

  ['result-photo', 'result-photo-small'].forEach((id) => {
    document.getElementById(id).src = state.objectUrl;
  });

  document.getElementById('demo-score').textContent = result.score;
  document.getElementById('share-score').textContent = result.score;
  document.getElementById('demo-match').textContent = `${result.match}% visual vibe`;
  document.getElementById('strong-feature').textContent = result.feature;
  document.getElementById('photo-style').textContent = result.style;
  document.getElementById('face-frame').textContent = result.frame;
  document.getElementById('twin-label').textContent = result.archetype;
  document.getElementById('paywall-score-leading').textContent = result.score.charAt(0);
  document.getElementById('paywall-match-last').textContent = result.match.toString().slice(-1);
}

function runScan() {
  if (!state.file || !consent.checked) return;

  if (state.scanTimer) window.clearInterval(state.scanTimer);
  document.getElementById('scan-photo').src = state.objectUrl;
  const msg = document.getElementById('scan-message');
  const bar = document.getElementById('scan-progress-bar');
  const messages = [
    ['Checking image quality', 14],
    ['Reading photo composition', 36],
    ['Preparing your entertainment score', 62],
    ['Creating your visual-vibe result', 84],
    ['Reveal ready', 100],
  ];

  let index = 0;
  msg.textContent = messages[0][0];
  bar.style.width = `${messages[0][1]}%`;
  showScreen('scan');
  track('analysis_started');

  state.scanTimer = window.setInterval(() => {
    index += 1;
    if (index >= messages.length) {
      window.clearInterval(state.scanTimer);
      state.scanTimer = null;
      hydrateResult();
      track('analysis_completed');
      window.setTimeout(() => showScreen('paywall'), 350);
      return;
    }
    msg.textContent = messages[index][0];
    bar.style.width = `${messages[index][1]}%`;
  }, 520);
}

function resetApp() {
  if (state.scanTimer) window.clearInterval(state.scanTimer);
  state.scanTimer = null;
  state.file = null;
  state.result = null;
  clearObjectUrl();

  preview.removeAttribute('src');
  preview.style.display = 'none';
  uploadEmpty.style.display = 'grid';
  fileInput.value = '';
  homeFileInput.value = '';
  consent.checked = false;
  analyzeBtn.disabled = true;
  document.getElementById('scan-progress-bar').style.width = '8%';
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

  const glow = ctx.createRadialGradient(860, 210, 10, 860, 210, 520);
  glow.addColorStop(0, 'rgba(255,110,199,.55)');
  glow.addColorStop(1, 'rgba(255,110,199,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 800);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText('FaceReveal', 74, 105);

  const img = await imageFromObjectUrl(state.objectUrl);
  ctx.save();
  roundRect(ctx, 74, 190, 932, 932, 58);
  ctx.clip();
  const scale = Math.max(932 / img.width, 932 / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, 74 + (932 - w) / 2, 190 + (932 - h) / 2, w, h);
  ctx.restore();

  const overlay = ctx.createLinearGradient(0, 650, 0, 1122);
  overlay.addColorStop(0, 'rgba(0,0,0,0)');
  overlay.addColorStop(1, 'rgba(0,0,0,.82)');
  ctx.fillStyle = overlay;
  ctx.fillRect(74, 620, 932, 502);

  ctx.fillStyle = '#cdb8ff';
  ctx.font = '800 28px system-ui, sans-serif';
  ctx.fillText('AI PHOTO REVEAL', 90, 1218);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 185px system-ui, sans-serif';
  ctx.fillText(state.score, 84, 1430);
  ctx.font = '700 48px system-ui, sans-serif';
  ctx.fillText('/10', 468, 1425);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 52px system-ui, sans-serif';
  ctx.fillText('My FaceReveal result 👀', 84, 1535);

  ctx.fillStyle = '#aaa7b6';
  ctx.font = '500 34px system-ui, sans-serif';
  ctx.fillText(`${state.match}% visual-vibe match • ${state.result?.archetype || 'Demo archetype'}`, 84, 1600);

  ctx.fillStyle = '#b8b4c4';
  ctx.font = '600 32px system-ui, sans-serif';
  ctx.fillText('What do you get?', 84, 1815);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

async function shareResult() {
  track('share_clicked');
  const text = `My FaceReveal demo score is ${state.score}/10 👀`;

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

  if (navigator.share) {
    try {
      await navigator.share({ title: 'My FaceReveal', text });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Share text copied to clipboard.');
  } catch {
    showToast(text);
  }
}

document.getElementById('home-upload-btn').addEventListener('click', () => {
  track('upload_started');
  homeFileInput.click();
});

homeFileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setPhoto(file);
  showScreen('upload');
});

fileInput.addEventListener('change', (event) => setPhoto(event.target.files?.[0]));
consent.addEventListener('change', () => {
  analyzeBtn.disabled = !(state.file && consent.checked);
});
analyzeBtn.addEventListener('click', runScan);

document.querySelectorAll('[data-back]').forEach((button) => {
  button.addEventListener('click', () => showScreen(button.dataset.back));
});

document.getElementById('checkout-btn').addEventListener('click', () => {
  track('checkout_clicked', { price: 9.99, demo: true });
  showToast('Demo mode: no payment will be taken. Tap “Preview unlocked result” below.');
});

document.getElementById('demo-unlock-btn').addEventListener('click', () => {
  track('demo_unlocked');
  hydrateResult();
  showScreen('result');
});

document.getElementById('restart-btn').addEventListener('click', resetApp);
document.getElementById('share-btn').addEventListener('click', shareResult);

document.getElementById('privacy-btn').addEventListener('click', () => {
  document.getElementById('privacy-dialog').showModal();
});

document.getElementById('privacy-close').addEventListener('click', () => {
  document.getElementById('privacy-dialog').close();
});

if (demoBanner) {
  demoBanner.addEventListener('click', () => showToast('Demo mode: your photo stays in this browser and no payment is taken.'));
}

window.addEventListener('beforeunload', clearObjectUrl);
track('landing_view');
