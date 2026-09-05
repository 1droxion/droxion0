const crypto = require('crypto');

const EXPECTED_PAYMENT_LINK_ID = 'plink_1UCP0ZEDfCCl7PueZK6csmHR';
const EXPECTED_PRICE_ID = 'price_1UCOnIEDfCCl7PuejRdiW3tv';
const EXPECTED_AMOUNT = 999;
const EXPECTED_CURRENCY = 'usd';
const ACCESS_COOKIE = 'facereveal_access';
const ACCESS_SECONDS = 60 * 60 * 24 * 400;

function accessKey(secret) {
  return crypto.createHash('sha256').update(`facereveal-access:${secret}`).digest();
}

function createAccessToken(secret) {
  const expires = Math.floor(Date.now() / 1000) + ACCESS_SECONDS;
  const payload = `v1.${expires}`;
  const signature = crypto.createHmac('sha256', accessKey(secret)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, reason: 'method_not_allowed' });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ ok: false, reason: 'server_not_configured' });
    return;
  }

  const sessionId = typeof req.query?.session_id === 'string' ? req.query.session_id.trim() : '';
  if (!sessionId || !sessionId.startsWith('cs_')) {
    res.status(400).json({ ok: false, reason: 'invalid_session_id' });
    return;
  }

  try {
    const stripeUrl = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
    stripeUrl.searchParams.append('expand[]', 'line_items');

    const stripeResponse = await fetch(stripeUrl, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
      },
    });

    if (!stripeResponse.ok) {
      console.error('Stripe session lookup failed', stripeResponse.status, await stripeResponse.text());
      res.status(400).json({ ok: false, reason: 'session_lookup_failed' });
      return;
    }

    const session = await stripeResponse.json();
    const lineItems = session?.line_items?.data || [];
    const expectedLineItem = lineItems.some((item) => item?.price?.id === EXPECTED_PRICE_ID && item?.quantity === 1);

    const paid =
      session?.livemode === true &&
      session?.mode === 'payment' &&
      session?.status === 'complete' &&
      session?.payment_status === 'paid' &&
      session?.payment_link === EXPECTED_PAYMENT_LINK_ID &&
      session?.currency === EXPECTED_CURRENCY &&
      session?.amount_total === EXPECTED_AMOUNT &&
      expectedLineItem;

    if (!paid) {
      res.status(402).json({ ok: false, reason: 'payment_not_verified' });
      return;
    }

    const accessToken = createAccessToken(secret);
    res.setHeader(
      'Set-Cookie',
      `${ACCESS_COOKIE}=${accessToken}; Max-Age=${ACCESS_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`
    );

    res.status(200).json({
      ok: true,
      entitled: true,
      session_id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      payment_status: session.payment_status,
    });
  } catch (error) {
    console.error('verify-payment failed', error);
    res.status(500).json({ ok: false, reason: 'server_error' });
  }
};
