(() => {
  const PIXEL_ID = '1026577833673171';
  const PRODUCT_NAME = 'FaceReveal Full Reveal';
  const PRICE_ID = 'price_1UCsuREDfCCl7Puewciwlkpv';
  const PAYMENT_LINK_ID = 'plink_1UCswAEDfCCl7PueJG9W2Yj9';
  const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/dRm3cvfdtbh0eFB9H57Re01';
  const VALUE = 2.99;
  const CURRENCY = 'USD';
  const PENDING_DB = 'facereveal-pending-v1';
  const PENDING_STORE = 'checkout';
  const PENDING_KEY = 'pending-reveal';
  let selectedFile = null;

  // Keep every customer-facing price in sync with the live one-time offer.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    if (node.nodeValue?.includes('$9.99')) node.nodeValue = node.nodeValue.replaceAll('$9.99', '$2.99');
  });

  // FaceReveal intentionally sends only generic funnel events to Meta.
  // Never send selfie data, facial measurements, scores, celebrity matches,
  // selected candidate categories, file names, or other face-derived data.
  if (!window.fbq) {
    const fbq = function () {
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }

  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');

  function trackCustom(name, params = {}) {
    try {
      window.fbq?.('trackCustom', name, params);
    } catch (error) {
      console.warn('Meta custom event failed', name, error);
    }
  }

  function trackStandard(name, params = {}) {
    try {
      window.fbq?.('track', name, params);
    } catch (error) {
      console.warn('Meta event failed', name, error);
    }
  }

  ['home-file-input', 'file-input'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', (event) => {
      const file = event.target?.files?.[0] || null;
      if (!file) return;
      selectedFile = file;
      trackCustom('SelfieUpload');
    });
  });

  const paywall = document.getElementById('screen-paywall');
  let analysisTracked = paywall?.classList.contains('screen-active') || false;
  if (analysisTracked) trackCustom('AnalysisComplete');

  if (paywall) {
    const observer = new MutationObserver(() => {
      if (!analysisTracked && paywall.classList.contains('screen-active')) {
        analysisTracked = true;
        trackCustom('AnalysisComplete');
      }
      if (!paywall.classList.contains('screen-active')) analysisTracked = false;
    });
    observer.observe(paywall, { attributes: true, attributeFilter: ['class'] });
  }

  function selectedCategory() {
    return document.querySelector('input[name="celebrity-category"]:checked')?.value || 'all';
  }

  async function savePendingRevealFromSelectedFile() {
    if (!selectedFile) {
      throw new Error('Your selfie is missing. Please upload it again.');
    }

    const request = indexedDB.open(PENDING_DB, 1);
    const db = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const opened = request.result;
        if (!opened.objectStoreNames.contains(PENDING_STORE)) opened.createObjectStore(PENDING_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local checkout storage.'));
    });

    const payload = {
      blob: selectedFile,
      name: selectedFile.name || 'facereveal-selfie.jpg',
      type: selectedFile.type || 'image/jpeg',
      lastModified: selectedFile.lastModified || Date.now(),
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

  const checkoutButton = document.getElementById('checkout-btn');
  checkoutButton?.addEventListener('click', async (event) => {
    // Capture phase prevents the legacy $9.99 handler in app.js from running.
    event.preventDefault();
    event.stopImmediatePropagation();

    if (checkoutButton.disabled) return;
    const oldLabel = checkoutButton.textContent;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Opening secure checkout…';

    try {
      await savePendingRevealFromSelectedFile();

      trackStandard('InitiateCheckout', {
        value: VALUE,
        currency: CURRENCY,
        content_name: PRODUCT_NAME,
        content_type: 'product',
        content_ids: [PRICE_ID],
        payment_link_id: PAYMENT_LINK_ID,
      });

      window.location.assign(STRIPE_CHECKOUT_URL);
    } catch (error) {
      console.error('FaceReveal $2.99 checkout failed', error);
      checkoutButton.disabled = false;
      checkoutButton.textContent = oldLabel;
      window.showToast?.(error.message || 'Could not open secure checkout. Please try again.');
    }
  }, true);

  async function trackVerifiedPurchase() {
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    if (!sessionId || !sessionId.startsWith('cs_')) return;

    const dedupeKey = `facereveal-meta-purchase:${sessionId}`;
    try {
      if (localStorage.getItem(dedupeKey) === '1') return;
    } catch {}

    try {
      const response = await fetch(`/api/verify-payment?session_id=${encodeURIComponent(sessionId)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) return;

      trackStandard('Purchase', {
        value: VALUE,
        currency: CURRENCY,
        content_name: PRODUCT_NAME,
        content_type: 'product',
        content_ids: [PRICE_ID],
        payment_link_id: PAYMENT_LINK_ID,
      });

      try {
        localStorage.setItem(dedupeKey, '1');
      } catch {}
    } catch (error) {
      console.warn('Meta Purchase verification failed', error);
    }
  }

  trackVerifiedPurchase();
})();
