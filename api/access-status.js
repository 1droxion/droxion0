const crypto = require('crypto');

const ACCESS_COOKIE = 'facereveal_access';

function accessKey(secret) {
  return crypto.createHash('sha256').update(`facereveal-access:${secret}`).digest();
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return [part.trim(), ''];
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }).filter(([key]) => key)
  );
}

function validAccessToken(secret, token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000)) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', accessKey(secret)).update(payload).digest('base64url');
  const actual = parts[2];
  if (expected.length !== actual.length) return false;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, entitled: false });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ ok: false, entitled: false });
    return;
  }

  const cookies = parseCookies(req.headers.cookie || '');
  const entitled = validAccessToken(secret, cookies[ACCESS_COOKIE]);
  res.status(200).json({ ok: true, entitled });
};
