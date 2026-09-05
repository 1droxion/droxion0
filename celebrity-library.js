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

  function initials(name) {
    return name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  }

  function placeholderPercent(name, rank) {
    const source = `${name}|${window.FaceRevealResultSeed || 0}|${rank}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    return 60 + (Math.abs(hash) % 18);
  }

  function makeCard(name, rank) {
    const article = document.createElement('article');
    article.className = 'celebrity-card celebrity-match-card';
    article.dataset.name = name;
    article.dataset.rank = String(rank);
    article.dataset.similarity = '0';

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
    pct.className = 'celebrity-percent';
    pct.textContent = `${placeholderPercent(name, rank)}%`;
    top.append(title, pct);

    const sub = document.createElement('small');
    sub.className = 'celebrity-sub';
    sub.textContent = 'measuring facial resemblance…';
    body.append(top, sub);
    article.append(media, body);
    return article;
  }

  function renderInstant(names) {
    grid.replaceChildren();
    names.forEach((name, index) => grid.appendChild(makeCard(name, index)));
    status.textContent = `${names.length} candidates ready • measuring resemblance…`;
  }

  function sortCards() {
    const cards = [...grid.querySelectorAll('.celebrity-match-card')];
    cards.sort((a, b) => Number(b.dataset.similarity || 0) - Number(a.dataset.similarity || 0));
    cards.forEach((card) => grid.appendChild(card));
  }

  async function analyzeCelebrityCard(card, src, thisRequest) {
    const media = card.querySelector('.celebrity-media');
    const pct = card.querySelector('.celebrity-percent');
    const sub = card.querySelector('.celebrity-sub');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.loading = 'eager';
    img.alt = `${card.dataset.name} portrait`;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });

    if (thisRequest !== requestId) return false;
    media.replaceChildren(img);

    const api = window.FaceRevealFaceGate;
    const userGeometry = window.FaceRevealUserGeometry;
    if (!api?.analyzeGeometry || !api?.geometrySimilarity || !userGeometry) {
      sub.textContent = 'portrait loaded';
      return false;
    }

    try {
      const celebrityGeometry = await api.analyzeGeometry(img);
      if (!celebrityGeometry || thisRequest !== requestId) {
        sub.textContent = 'portrait loaded';
        return false;
      }

      const similarity = api.geometrySimilarity(userGeometry, celebrityGeometry);
      if (!Number.isFinite(similarity)) {
        sub.textContent = 'portrait loaded';
        return false;
      }

      card.dataset.similarity = String(similarity);
      pct.textContent = `${similarity}%`;
      sub.textContent = 'facial-structure resemblance';
      return true;
    } catch (error) {
      console.warn('Celebrity face analysis failed', card.dataset.name, error);
      sub.textContent = 'portrait loaded';
      return false;
    }
  }

  async function upgradeImagesAndRank(names) {
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
      const cards = [...grid.querySelectorAll('.celebrity-match-card')];

      let completed = 0;
      let measured = 0;
      status.textContent = `${names.length} candidates • comparing facial structure…`;

      await Promise.allSettled(cards.map(async (card) => {
        const src = byTitle.get(card.dataset.name);
        if (!src) {
          completed += 1;
          return;
        }
        const ok = await analyzeCelebrityCard(card, src, thisRequest);
        if (ok) measured += 1;
        completed += 1;
        if (thisRequest === requestId) {
          sortCards();
          status.textContent = measured
            ? `${measured} measured • ranking closest facial structures…`
            : `${completed}/${names.length} portraits loaded`;
        }
      }));

      if (thisRequest === requestId) {
        sortCards();
        status.textContent = measured
          ? `${measured} facial resemblance scores measured`
          : `${names.length} results ready`;
      }
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
      ? 'Comparing your facial structure with women celebrity portraits you selected.'
      : category === 'men'
        ? 'Comparing your facial structure with men celebrity portraits you selected.'
        : 'Comparing your facial structure with a mixed celebrity set.';

    renderInstant(names);
    refresh.disabled = false;
    upgradeImagesAndRank(names);
  }

  refresh.addEventListener('click', () => {
    offset += 6;
    loadSet();
  });

  document.querySelectorAll('input[name="celebrity-category"]').forEach((radio) => {
    radio.addEventListener('change', () => { offset = 0; });
  });

  window.FaceRevealCelebrityMatches = { loadSet };
})();
