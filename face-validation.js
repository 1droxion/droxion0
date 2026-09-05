(() => {
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';
  const analyzeButton = document.getElementById('analyze-btn');
  const preview = document.getElementById('upload-preview');
  const consent = document.getElementById('consent');

  let modelPromise = null;
  let validatedSrc = null;

  function toast(message) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
      return;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), 3200);
  }

  function setButtonBusy(busy, label = 'Checking face…') {
    if (!analyzeButton) return;
    if (busy) {
      analyzeButton.dataset.originalLabel = analyzeButton.textContent;
      analyzeButton.textContent = label;
      analyzeButton.disabled = true;
      analyzeButton.setAttribute('aria-busy', 'true');
    } else {
      analyzeButton.textContent = analyzeButton.dataset.originalLabel || 'Analyze my face ✨';
      analyzeButton.disabled = !(preview?.src && consent?.checked);
      analyzeButton.removeAttribute('aria-busy');
    }
  }

  function waitForImage(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onLoad = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Image could not be read.')); };
      const cleanup = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    });
  }

  function loadModels() {
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      if (!window.faceapi?.nets?.tinyFaceDetector || !window.faceapi?.nets?.faceLandmark68TinyNet) {
        throw new Error('Face analysis library did not load.');
      }
      await Promise.all([
        window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ]);
      return true;
    })().catch((error) => {
      modelPromise = null;
      throw error;
    });
    return modelPromise;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function average(points) {
    return points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  }

  function center(points) {
    const sum = average(points);
    return { x: sum.x / points.length, y: sum.y / points.length };
  }

  function extractGeometry(landmarks) {
    const src = landmarks?.positions || landmarks;
    if (!src || src.length < 68) return null;

    const leftEye = center(src.slice(36, 42));
    const rightEye = center(src.slice(42, 48));
    const midEye = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const eyeDistance = Math.max(1, distance(leftEye, rightEye));
    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);

    const p = src.map((point) => {
      const x = point.x - midEye.x;
      const y = point.y - midEye.y;
      return {
        x: (x * cos - y * sin) / eyeDistance,
        y: (x * sin + y * cos) / eyeDistance,
      };
    });

    const c = (start, end) => center(p.slice(start, end));
    const mouthCenter = c(48, 68);
    const leftEyeR = c(36, 42);
    const rightEyeR = c(42, 48);
    const eyeY = (leftEyeR.y + rightEyeR.y) / 2;

    return {
      faceWidth: distance(p[0], p[16]),
      jawWidth: distance(p[4], p[12]),
      faceHeight: Math.abs(p[8].y - eyeY),
      eyeWidth: (distance(p[36], p[39]) + distance(p[42], p[45])) / 2,
      eyeOpening: (distance(p[37], p[41]) + distance(p[38], p[40]) + distance(p[43], p[47]) + distance(p[44], p[46])) / 4,
      noseWidth: distance(p[31], p[35]),
      noseLength: Math.abs(p[33].y - p[27].y),
      eyeToNose: Math.abs(p[33].y - eyeY),
      mouthWidth: distance(p[48], p[54]),
      mouthHeight: Math.abs(p[57].y - p[51].y),
      eyeToMouth: Math.abs(mouthCenter.y - eyeY),
      browGap: (Math.abs(c(17, 22).y - leftEyeR.y) + Math.abs(c(22, 27).y - rightEyeR.y)) / 2,
      chinToMouth: Math.abs(p[8].y - mouthCenter.y),
    };
  }

  const TOLERANCE = {
    faceWidth: 0.28,
    jawWidth: 0.25,
    faceHeight: 0.30,
    eyeWidth: 0.16,
    eyeOpening: 0.12,
    noseWidth: 0.17,
    noseLength: 0.24,
    eyeToNose: 0.22,
    mouthWidth: 0.20,
    mouthHeight: 0.16,
    eyeToMouth: 0.25,
    browGap: 0.16,
    chinToMouth: 0.22,
  };

  function geometrySimilarity(a, b) {
    if (!a || !b) return null;
    const keys = Object.keys(TOLERANCE);
    let weighted = 0;
    let totalWeight = 0;

    for (const key of keys) {
      const av = Number(a[key]);
      const bv = Number(b[key]);
      if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
      const tolerance = TOLERANCE[key];
      const diff = Math.abs(av - bv) / tolerance;
      const weight = ['faceWidth','faceHeight','eyeToNose','eyeToMouth','noseWidth','mouthWidth'].includes(key) ? 1.25 : 1;
      weighted += Math.min(diff, 3) ** 2 * weight;
      totalWeight += weight;
    }

    if (!totalWeight) return null;
    const rms = Math.sqrt(weighted / totalWeight);
    const score = 100 - rms * 19;
    return Math.round(Math.max(45, Math.min(96, score)));
  }

  function options() {
    return new window.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.52 });
  }

  async function analyzeGeometry(img) {
    await waitForImage(img);
    await loadModels();
    const result = await window.faceapi.detectSingleFace(img, options()).withFaceLandmarks(true);
    if (!result?.landmarks) return null;
    return extractGeometry(result.landmarks);
  }

  async function validateOneClearFace(img) {
    await waitForImage(img);
    await loadModels();

    const detections = await window.faceapi.detectAllFaces(img, options());

    if (detections.length === 0) {
      return { ok: false, reason: 'NO_FACE', message: 'No clear human face found. Please upload a front-facing selfie with your face visible.' };
    }

    if (detections.length > 1) {
      return { ok: false, reason: 'MULTIPLE_FACES', message: `We found ${detections.length} faces. Please upload a selfie with only one person.` };
    }

    const detection = detections[0];
    const box = detection.box;
    const imageArea = Math.max(1, img.naturalWidth * img.naturalHeight);
    const faceAreaRatio = (box.width * box.height) / imageArea;
    const minFaceSide = Math.min(box.width, box.height);

    if (detection.score < 0.58 || minFaceSide < 90 || faceAreaRatio < 0.035) {
      return { ok: false, reason: 'FACE_TOO_SMALL_OR_UNCLEAR', message: 'A face was found, but it is too small or unclear. Use a closer, well-lit selfie.' };
    }

    const landmarkResult = await window.faceapi.detectSingleFace(img, options()).withFaceLandmarks(true);
    const geometry = extractGeometry(landmarkResult?.landmarks);
    if (!geometry) {
      return { ok: false, reason: 'LANDMARKS_UNCLEAR', message: 'We found your face, but could not read enough facial detail. Try a clearer front-facing selfie.' };
    }

    window.FaceRevealUserGeometry = geometry;

    return {
      ok: true,
      reason: 'ONE_CLEAR_FACE',
      score: Number(detection.score.toFixed(3)),
      faceAreaRatio: Number(faceAreaRatio.toFixed(3)),
      geometryReady: true,
    };
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!preview?.src || !consent?.checked) return;

    if (validatedSrc === preview.src && window.FaceRevealUserGeometry) {
      if (typeof window.runScan === 'function') window.runScan();
      return;
    }

    setButtonBusy(true, 'Measuring face…');

    try {
      const result = await validateOneClearFace(preview);
      console.info('[FaceReveal event]', 'face_gate_checked', result);

      if (!result.ok) {
        validatedSrc = null;
        window.FaceRevealUserGeometry = null;
        toast(result.message);
        return;
      }

      validatedSrc = preview.src;
      toast('Face measured ✓');
      if (typeof window.runScan === 'function') window.runScan();
      else throw new Error('Scan flow is unavailable.');
    } catch (error) {
      console.error('Face validation failed', error);
      validatedSrc = null;
      window.FaceRevealUserGeometry = null;
      toast('Face checker could not load. Check your connection and try again.');
    } finally {
      setButtonBusy(false);
    }
  }

  function resetValidation() {
    validatedSrc = null;
    window.FaceRevealUserGeometry = null;
  }

  analyzeButton?.addEventListener('click', handleAnalyze, true);
  document.getElementById('file-input')?.addEventListener('change', resetValidation);
  document.getElementById('home-file-input')?.addEventListener('change', resetValidation);

  const warmModels = () => {
    loadModels().catch(() => {});
    window.removeEventListener('pointerdown', warmModels);
  };
  window.addEventListener('pointerdown', warmModels, { once: true, passive: true });

  window.FaceRevealFaceGate = {
    validateOneClearFace,
    resetValidation,
    analyzeGeometry,
    geometrySimilarity,
    extractGeometry,
    loadModels,
  };
})();
