(() => {
  const PRICE = 2.99;
  const CURRENCY = 'USD';
  const PRODUCT_NAME = 'FaceReveal Full Reveal';
  const OFFER_ID = 'facereveal_full_reveal_299';
  const PENDING_DB = 'facereveal-pending-v1';
  const PENDING_STORE = 'checkout';
  const PENDING_KEY = 'pending-reveal';

  const button = document.getElementById('checkout-btn');
  if (!button) return;

  function selectedCategory() {
    return document.querySelector('input[name="celebrity-category"]:checked')?.value || 'all';
  }

  async function savePendingRevealFromPreview() {
    const preview = document.getElementById('upload-preview');
    if (!preview?.src || !preview.src.startsWith('blob:')) {
      throw new Error('Your selfie is missing. Please upload it again.');
    }

    const blob = await fetch(preview.src).then((r) => r.blob());
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
      blob,
      name: 'facereveal-selfie.jpg',
      type: blob.type || 'image/jpeg',
      lastModified: Date.now(),
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

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.disabled) return;
    const oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening secure checkout…';

    try {
      await savePendingRevealFromPreview();

      try {
        window.fbq?.('track', 'InitiateCheckout', {
          value: PRICE,
          currency: CURRENCY,
          content_name: PRODUCT_NAME,
          content_type: 'product',
          content_ids: [OFFER_ID],
        });
      } catch (pixelError) {
        console.warn('Meta checkout event failed', pixelError);
      }

      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.url) throw new Error('Could not open secure checkout.');

      window.location.assign(data.url);
    } catch (error) {
      console.error('FaceReveal $2.99 checkout failed', error);
      button.disabled = false;
      button.textContent = oldLabel;
      window.showToast?.(error.message || 'Could not open secure checkout. Please try again.');
    }
  }, true);
})();
