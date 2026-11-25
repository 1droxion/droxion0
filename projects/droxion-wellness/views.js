const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const money = cents => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(cents / 100)
const defaults = {
  announcement:'Discover a new standard of intimate wellness.',
  headline:'Make tonight feel closer.',
  featured:'water-based-16oz',
  story:'DROXION Wellness is an emerging intimate care brand built around simplicity, comfort and confidence. Our mission is to make premium personal wellness accessible.',
  contact:'', instagram:'', facebook:'', mode:'coming-soon'
}
const links = [['/shop','Shop'],['/about','About'],['/faq','FAQ'],['/contact','Contact']]
const policies = [['/privacy','Privacy Policy'],['/terms','Terms of Service'],['/shipping','Shipping Policy'],['/returns','Return Policy']]
const navLinks = items => items.map(([href,label]) => `<a href="${href}">${label}</a>`).join('')
const asset = (p, size=900) => p.customImage ? '/media/' + p.customImage : `/images/${p.image}-${size}.webp`
function photo(p, priority=false) {
  if (!p) return ''
  const responsive = p.customImage ? '' : `srcset="${asset(p,480)} 480w, ${asset(p)} 900w" sizes="(max-width: 720px) 92vw, ${priority ? '48vw' : '32vw'}"`
  return `<img src="${asset(p,480)}" ${responsive} width="480" height="640" ${priority ? 'fetchpriority="high"' : 'loading="lazy"'} alt="${esc('DROXION ' + p.name + ', ' + p.size + ', packaging concept')}">`
}
function layout({title, description='Explore DROXION Wellness, a new intimate care collection in development.', path='/', body, settings=defaults, image='/images/water16-900.webp', admin=false, staging=false, product=''}) {
  const canonical = 'https://droxion.com' + path
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | DROXION Wellness</title>
<meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(title)} | DROXION Wellness"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="https://droxion.com${image}">
${(admin || staging) ? '<meta name="robots" content="noindex,nofollow">' : ''}<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"><script src="/client.js" defer></script></head>
<body data-product="${esc(product)}" data-public="${!admin}"><a class="skip" href="#main">Skip to content</a>
${admin ? '' : `<div class="announcement">${esc(settings.announcement)}</div>`}
<header><nav class="wrap"><a class="brand" href="/">DROXION<small>WELLNESS</small></a>${admin ? '' : `<div class="navlinks">${navLinks(links)}</div><a class="search" href="/search" aria-label="Search"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></a><details class="mobile"><summary>Menu</summary><div>${navLinks(links)}</div></details>`}</nav></header>
<main id="main">${body}</main><footer><div class="wrap foot"><div><a class="brand" href="/">DROXION<small>WELLNESS</small></a><p>Intimate care. Premium feel.</p></div><div>${navLinks(links)}${navLinks(policies)}${settings.instagram ? `<a href="${esc(settings.instagram)}">Instagram</a>` : ''}${settings.facebook ? `<a href="${esc(settings.facebook)}">Facebook</a>` : ''}</div></div><div class="wrap copyright">© ${new Date().getFullYear()} DROXION Wellness</div></footer></body></html>`
}
function card(p) {
  const href = '/products/' + p.slug
  return `<article><a class="cardphoto" href="${href}" data-interest="${p.slug}">${photo(p)}<span class="status">${esc(p.availability)}</span></a><p class="size">${esc(p.size)}</p><h3><a href="${href}" data-interest="${p.slug}">${esc(p.name)}</a></h3><p class="price">${money(p.price)} <small>Proposed price</small></p><div class="cardlinks"><a href="${href}" data-interest="${p.slug}">View Product</a><a href="${href}#notify" data-notify="${p.slug}">Notify Me</a></div></article>`
}
function signup(products, selected='') {
  return `<form class="signup" action="/subscribe" method="post"><label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" maxlength="254" required></label>
  ${products.length ? `<fieldset><legend>Product interests • optional</legend>${products.map(p => `<label><input type="checkbox" name="products" value="${p.slug}" ${p.slug===selected?'checked':''}> ${esc(p.size.split(' /')[0] + ' ' + p.name.replace(' Personal Lubricant',''))}</label>`).join('')}</fieldset>` : ''}
  <div hidden><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div><label class="consent"><input type="checkbox" name="consent" value="yes" required> Email me about the DROXION launch.</label><button class="button">Notify me</button><p class="micro">See our <a href="/privacy">Privacy Policy</a>.</p><p class="feedback" role="status"></p></form>`
}
const pending = 'Final details are pending manufacturer confirmation.'
const faq = (pairs) => pairs.map(([q,a])=>`<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')
const commonFAQ = [['When can I order?','The first collection is in development. Orders and preorders are closed.'],['Are the bottles pictured final?','The images depict packaging concepts. Final packaging and pricing may change.'],['What about ingredients, usage and compatibility?', pending],['How do I get launch updates?','Join the launch list and select any products you’re interested in.']]
function home(products, settings, signupOpen) {
  const p = products.find(p => p.slug === settings.featured) || products[0]
  const flagship = p?.slug === 'water-based-16oz' && !p.customImage && p.image === 'water16'
  const headline = settings.headline === 'Closer. Naturally.' ? defaults.headline : settings.headline
  const pitch = flagship
    ? `<p class="hero-product">${esc(p.name)} · 16 fl oz</p><p class="hero-note">Adds glide during intimacy.</p>`
    : '<p class="hero-note">Explore our first intimate care collection.</p>'
  const heroPhoto = flagship
    ? '<img src="/images/water16-crimson-480.webp" srcset="/images/water16-crimson-480.webp 480w, /images/water16-crimson-900.webp 900w" sizes="(max-width: 720px) 92vw, 46vw" width="480" height="600" fetchpriority="high" alt="DROXION 16 fl oz water-based personal lubricant packaging concept under red lighting">'
    : photo(p,true)
  return `<section class="hero-band"><div class="wrap hero"><div class="herocopy"><h1>${esc(headline)}</h1>${pitch}<div class="actions"><a class="button" href="#launch"${flagship?' data-notify="water-based-16oz"':''}>Notify Me at Launch</a><a class="button secondary" href="#collection">Explore the Collection</a></div></div>${p ? `<figure class="heroimage ${flagship?'hero-crimson':'hero-standard'}">${heroPhoto}<figcaption>Packaging concept</figcaption></figure>` : ''}</div></section>
  <section class="wrap section" id="collection"><div class="sectionhead"><div><p class="kicker">THE FIRST COLLECTION</p><h2>Care, made personal.</h2></div><p>Our first three products are in development. Packaging and pricing are preliminary.</p></div><div class="grid">${products.map(card).join('')}</div></section>
  <section class="story"><div class="wrap storyinner"><h2>Intimate wellness,<br><em>reimagined.</em></h2><p>${esc(settings.story)}</p></div></section>
  <section class="wrap section launch" id="launch"><div><h2>Be First to Experience DROXION.</h2><p>Get an email when our first collection is ready.</p></div>${signupOpen ? signup(products,flagship?p.slug:undefined) : '<p>Launch signups will open when the service is ready.</p>'}</section>`
}
function productPage(p, products, signupOpen) {
  return `<section class="wrap section"><a class="back" href="/shop">← Collection</a>
  <div class="detailgrid"><div><figure class="detailimage"><button class="imagebutton" data-zoom aria-label="Enlarge packaging concept">${photo(p,true)}</button><figcaption>Packaging concept · Select image to enlarge</figcaption></figure>
  <dialog class="zoom"><form method="dialog"><button class="button secondary">Close</button></form><img src="${asset(p)}" alt="${esc(p.name)} packaging concept" loading="lazy"></dialog></div>
  <div itemscope itemtype="https://schema.org/Product"><p class="kicker">${esc(p.availability)}</p><h1 itemprop="name">${esc(p.name)} · ${esc(p.size.split(" /")[0])}</h1><p class="size">${esc(p.size)}</p><p class="price">${money(p.price)} <small>Proposed price</small></p><p itemprop="description">${esc(p.description)}</p>
  <section id="notify"><h2>Notify Me</h2>${signupOpen ? signup(products,p.slug) : '<p>Launch signups will open when the service is ready.</p>'}</section></div></div>
  <section class="spec"><h2>Product details</h2>${faq([['Ingredients',pending],['How to use',pending],['Safety and compatibility',pending],['When will this size be available?',commonFAQ[0][1]],['Is this the final bottle?',commonFAQ[1][1]]])}</section>
  <section class="spec"><h2>Explore the collection</h2><div class="grid">${products.filter(other=>other.slug!==p.slug).map(card).join('')}</div></section></section>`
}
const simple = (title, content) => `<section class="wrap section narrow"><h1>${esc(title)}</h1>${content}</section>`
module.exports = { esc, money, defaults, asset, layout, card, signup, faq, commonFAQ, home, productPage, simple }
