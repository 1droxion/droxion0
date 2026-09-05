(() => {
  const GROUPS = {
    women: ['Taylor Swift','Zendaya','Selena Gomez','Ariana Grande','Rihanna','Beyoncé','Margot Robbie','Priyanka Chopra Jonas','Deepika Padukone','Alia Bhatt','Lisa (rapper)','Jennie (singer)'],
    men: ['Dwayne Johnson','Chris Hemsworth','Leonardo DiCaprio','Tom Holland','Shah Rukh Khan','Ranveer Singh','Hrithik Roshan','Jungkook','V (singer)','Cristiano Ronaldo','Lionel Messi','Bad Bunny']
  };

  const API = 'https://en.wikipedia.org/w/api.php';
  const grid = document.getElementById('celebrity-grid');
  const status = document.getElementById('celebrity-status');
  const label = document.getElementById('celebrity-filter-label');
  const refresh = document.getElementById('celebrity-refresh-btn');
  if (!grid || !status || !label || !refresh) return;

  let offset = 0;
  let requestId = 0;

  function selectedCategory() {
    return document.querySelector('input[name="celebrity-category"]:checked')?.value || 'all';
  }

  function namesForCategory(category) {
    if (category === 'women') return GROUPS.women;
    if (category === 'men') return GROUPS.men;
    return [...GROUPS.women, ...GROUPS.men];
  }

  function deterministicPercent(name, rank) {
    const source = `${name}|${window.FaceRevealResultSeed || 0}|${rank}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    return 72 + (Math.abs(hash) % 24);
  }

  function initials(name) {
    return name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  }

  function makeCard(name, rank) {
    const article = document.createElement('article');
    article.className = 'celebrity-card celebrity-match-card';
    article.dataset.name = name;

    const media = document.createElement('div');
    media.className = 'celebrity-media';
    const fallback = document.createElement('div');
    fallback.className = 'celebrity-fallback';
    fallback.textContent = initials(name);
    media.appendChild(fallback);

    const body = document.createElement('div');
    body.className = 'celebrity-match-body';
    const top = document.createElement('div');
    top.className = 'celebrity-match-top';
    const title = document.createElement('strong');
    title.textContent = name;
    const pct = document.createElement('span');
    pct.textContent = `${deterministicPercent(name, rank)}%`;
    top.append(title, pct);

    const sub = document.createElement('small');
    sub.textContent = 'entertainment vibe match';
    body.append(top, sub);
    article.append(media, body);
    return article;
  }

  function renderInstant(names) {
    grid.replaceChildren();
    names.forEach((name, index) => grid.appendChild(makeCard(name, index)));
    status.textContent = `${names.length} results ready • loading portraits…`;
  }

  async function upgradeImages(names) {
    const thisRequest = ++requestId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const params = new URLSearchParams({
        origin: '*',
        action: 'query',
        format: 'json',
        redirects: '1',
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: '640',
        titles: names.join('|')
      });

      const response = await fetch(`${API}?${params.toString()}`, { signal: controller.signal, cache: 'force-cache' });
      if (!response.ok || thisRequest !== requestId) return;

      const data = await response.json();
      const pages = Object.values(data?.query?.pages || {}).filter((p) => !p.missing && p.thumbnail?.source);
      const byTitle = new Map(pages.map((p) => [p.title, p.thumbnail.source]));
      let loaded = 0;

      grid.querySelectorAll('.celebrity-match-card').forEach((card) => {
        const src = byTitle.get(card.dataset.name);
        if (!src) return;

        const media = card.querySelector('.celebrity-media');
        const img = new Image();
        img.loading = 'eager';
        img.decoding = 'async';
        img.alt = `${card.dataset.name} portrait`;
        img.referrerPolicy = 'no-referrer';

        img.onload = () => {
          if (thisRequest !== requestId) return;
          media.replaceChildren(img);
          loaded += 1;
          status.textContent = loaded === names.length
            ? `${names.length} celebrity portraits ready`
            : `${names.length} results ready • ${loaded} portraits loaded`;
        };

        img.onerror = () => {
          console.warn('Celebrity portrait failed to load', card.dataset.name, src);
        };

        // Important: eager loading allows detached images to start downloading.
        // With lazy loading, some browsers never fired onload because the image
        // was not inserted until after onload.
        img.src = src;
      });
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('Celebrity portrait lookup failed', error);
      if (thisRequest === requestId) status.textContent = `${names.length} results ready`;
    } finally {
      clearTimeout(timer);
    }
  }

  function loadSet() {
    const category = selectedCategory();
    const allNames = namesForCategory(category);
    const pageSize = 6;
    const names = Array.from({ length: Math.min(pageSize, allNames.length) }, (_, i) => allNames[(offset + i) % allNames.length]);

    label.textContent = category === 'women'
      ? 'Showing women celebrity-style inspirations you selected.'
      : category === 'men'
        ? 'Showing men celebrity-style inspirations you selected.'
        : 'Showing a mixed set of celebrity-style inspirations.';

    renderInstant(names);
    refresh.disabled = false;
    upgradeImages(names);
  }

  refresh.addEventListener('click', () => {
    offset += 6;
    loadSet();
  });

  document.querySelectorAll('input[name="celebrity-category"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      offset = 0;
    });
  });

  window.FaceRevealCelebrityMatches = { loadSet };
})();
