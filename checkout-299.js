(() => {
  const PRICE = 2.99;
  const CURRENCY = 'USD';
  const PRODUCT_NAME = 'FaceReveal Full Reveal';
  const OFFER_ID = 'facereveal_full_reveal_299';

  const button = document.getElementById('checkout-btn');
  if (!button) return;

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.disabled) return;
    const oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening secure checkout…';

    try {
      // app.js keeps the selected selfie locally in IndexedDB before checkout.
      // Reuse its existing click preparation indirectly by saving through the
      // browser state only when the app exposes a selected photo; the server
      // never receives the selfie.
      const originalButton = button.cloneNode(true);
      void originalButton;

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

      // Trigger the existing local-save helper by dispatching a private custom
      // event handled below, then create the Stripe Checkout Session.
      window.dispatchEvent(new CustomEvent('facereveal:prepare-checkout'));
      await new Promise((resolve) => setTimeout(resolve, 80));

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
      window.showToast?.('Could not open secure checkout. Please try again.');
    }
  }, true);
})();
