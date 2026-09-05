(() => {
  const PIXEL_ID = '1026577833673171';
  const PRODUCT_NAME = 'FaceReveal Full Reveal';
  const PRICE_ID = 'price_1UCOnIEDfCCl7PuejRdiW3tv';
  const VALUE = 9.99;
  const CURRENCY = 'USD';

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
      if (!event.target?.files?.[0]) return;
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

  document.getElementById('checkout-btn')?.addEventListener('click', () => {
    trackStandard('InitiateCheckout', {
      value: VALUE,
      currency: CURRENCY,
      content_name: PRODUCT_NAME,
      content_type: 'product',
      content_ids: [PRICE_ID],
    });
  });

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
