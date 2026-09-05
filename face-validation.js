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
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Image could not be read.'));
      };
      const cleanup = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    });
  }

  function loadDetector() {
    if (modelPromise) return modelPromise;
    modelPromise = (async () => {
      if (!window.faceapi?.nets?.tinyFaceDetector) {
        throw new Error('Face detection library did not load.');
      }
      await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      return true;
    })().catch((error) => {
      modelPromise = null;
      throw error;
    });
    return modelPromise;
  }

  async function validateOneClearFace(img) {
    await waitForImage(img);
    await loadDetector();

    const options = new window.faceapi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.52,
    });

    const detections = await window.faceapi.detectAllFaces(img, options);

    if (detections.length === 0) {
      return {
        ok: false,
        reason: 'NO_FACE',
        message: 'No clear human face found. Please upload a front-facing selfie with your face visible.',
      };
    }

    if (detections.length > 1) {
      return {
        ok: false,
        reason: 'MULTIPLE_FACES',
        message: `We found ${detections.length} faces. Please upload a selfie with only one person.`,
      };
    }

    const detection = detections[0];
    const box = detection.box;
    const imageArea = Math.max(1, img.naturalWidth * img.naturalHeight);
    const faceAreaRatio = (box.width * box.height) / imageArea;
    const minFaceSide = Math.min(box.width, box.height);

    if (detection.score < 0.58 || minFaceSide < 90 || faceAreaRatio < 0.035) {
      return {
        ok: false,
        reason: 'FACE_TOO_SMALL_OR_UNCLEAR',
        message: 'A face was found, but it is too small or unclear. Use a closer, well-lit selfie.',
      };
    }

    return {
      ok: true,
      reason: 'ONE_CLEAR_FACE',
      score: Number(detection.score.toFixed(3)),
      faceAreaRatio: Number(faceAreaRatio.toFixed(3)),
    };
  }

  async function handleAnalyze(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!preview?.src || !consent?.checked) return;

    if (validatedSrc === preview.src) {
      if (typeof window.runScan === 'function') window.runScan();
      return;
    }

    setButtonBusy(true);

    try {
      const result = await validateOneClearFace(preview);
      console.info('[FaceReveal event]', 'face_gate_checked', result);

      if (!result.ok) {
        validatedSrc = null;
        toast(result.message);
        return;
      }

      validatedSrc = preview.src;
      toast('One clear face found ✓');
      if (typeof window.runScan === 'function') {
        window.runScan();
      } else {
        throw new Error('Scan flow is unavailable.');
      }
    } catch (error) {
      console.error('Face validation failed', error);
      validatedSrc = null;
      toast('Face checker could not load. Check your connection and try again.');
    } finally {
      setButtonBusy(false);
    }
  }

  function resetValidation() {
    validatedSrc = null;
  }

  analyzeButton?.addEventListener('click', handleAnalyze, true);
  document.getElementById('file-input')?.addEventListener('change', resetValidation);
  document.getElementById('home-file-input')?.addEventListener('change', resetValidation);

  // Start downloading the small detector model after the first user interaction,
  // without blocking page load. The photo itself is never sent to the CDN.
  const warmDetector = () => {
    loadDetector().catch(() => {});
    window.removeEventListener('pointerdown', warmDetector);
  };
  window.addEventListener('pointerdown', warmDetector, { once: true, passive: true });

  window.FaceRevealFaceGate = { validateOneClearFace, resetValidation };
})();
