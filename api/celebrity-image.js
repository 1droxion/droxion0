module.exports = async function handler(req, res) {
  try {
    const raw = req.query?.url;
    if (!raw || typeof raw !== 'string') {
      res.status(400).send('Missing image URL');
      return;
    }

    let target;
    try {
      target = new URL(raw);
    } catch {
      res.status(400).send('Invalid image URL');
      return;
    }

    const host = target.hostname.toLowerCase();
    const allowed = host === 'upload.wikimedia.org' || host.endsWith('.wikimedia.org');
    if (target.protocol !== 'https:' || !allowed) {
      res.status(403).send('Image host not allowed');
      return;
    }

    const upstream = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'FaceReveal/1.0 image-proxy',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    if (!upstream.ok) {
      res.status(upstream.status).send('Image unavailable');
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      res.status(415).send('Upstream response was not an image');
      return;
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(bytes);
  } catch (error) {
    console.error('celebrity-image proxy failed', error);
    res.status(500).send('Image proxy failed');
  }
};
