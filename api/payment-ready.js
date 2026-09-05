const PAYMENT_LINK_ID = 'plink_1UCP0ZEDfCCl7PueZK6csmHR';
const EXPECTED_RETURN_HOST = 'droxion0.vercel.app';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    res.status(200).json({ ready: false, reason: 'server_key_missing' });
    return;
  }

  try {
    const response = await fetch(`https://api.stripe.com/v1/payment_links/${PAYMENT_LINK_ID}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });

    if (!response.ok) {
      res.status(200).json({ ready: false, reason: 'stripe_link_check_failed' });
      return;
    }

    const link = await response.json();
    const redirectUrl = link?.after_completion?.redirect?.url || '';
    const redirectReady =
      link?.after_completion?.type === 'redirect' &&
      redirectUrl.includes(EXPECTED_RETURN_HOST) &&
      redirectUrl.includes('{CHECKOUT_SESSION_ID}');

    res.status(200).json({
      ready: Boolean(link?.active && redirectReady),
      reason: redirectReady ? null : 'redirect_not_configured',
    });
  } catch (error) {
    console.error('payment-ready failed', error);
    res.status(200).json({ ready: false, reason: 'server_error' });
  }
};
