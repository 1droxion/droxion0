module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ ok: false, reason: 'server_not_configured' });
    return;
  }

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = `${proto}://${host}`;

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${origin}/?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${origin}/?checkout=cancelled`);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][unit_amount]', '299');
    params.set('line_items[0][price_data][product_data][name]', 'FaceReveal Full Reveal');
    params.set('line_items[0][price_data][product_data][description]', 'One-time FaceReveal entertainment result');
    params.set('metadata[facereveal_offer]', 'full_reveal_299');
    params.set('metadata[facereveal_price_cents]', '299');
    params.set('automatic_tax[enabled]', 'true');

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json().catch(() => ({}));
    if (!stripeResponse.ok || !session?.url || !session?.id) {
      console.error('Stripe Checkout Session creation failed', stripeResponse.status, session);
      res.status(502).json({ ok: false, reason: 'checkout_creation_failed' });
      return;
    }

    res.status(200).json({ ok: true, url: session.url, session_id: session.id });
  } catch (error) {
    console.error('create-checkout failed', error);
    res.status(500).json({ ok: false, reason: 'server_error' });
  }
};
