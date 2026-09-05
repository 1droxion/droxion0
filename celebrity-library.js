(() => {
  const GROUPS = {
    women: [
      'Taylor Swift','Zendaya','Selena Gomez','Ariana Grande','Rihanna','Beyoncé','Margot Robbie','Priyanka Chopra Jonas','Deepika Padukone','Alia Bhatt','Lisa (rapper)','Jennie (singer)'
    ],
    men: [
      'Dwayne Johnson','Chris Hemsworth','Leonardo DiCaprio','Tom Holland','Shah Rukh Khan','Ranveer Singh','Hrithik Roshan','Jungkook','V (singer)','Cristiano Ronaldo','Lionel Messi','Bad Bunny'
    ]
  };

  const API = 'https://en.wikipedia.org/w/api.php';
  const grid = document.getElementById('celebrity-grid');
  const status = document.getElementById('celebrity-status');
  const label = document.getElementById('celebrity-filter-label');
  const refresh = document.getElementById('celebrity-refresh-btn');
  if (!grid || !status || !label || !refresh) return;

  let offset = 0;

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

  function card(person, rank) {
    const article = document.createElement('article');
    article.className = 'celebrity-card celebrity-match-card';

    const media = document.createElement('div');
    media.className = 'celebrity-media';
    if (person.thumbnail?.source) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = person.thumbnail.source;
      img.alt = `${person.title} portrait`;
      media.appendChild(img);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'celebrity-fallback';
      fallback.textContent = person.title.split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase();
      media.appendChild(fallback);
    }

    const body = document.createElement('div');
    body.className = 'celebrity-match-body';
    const top = document.createElement('div');
    top.className = 'celebrity-match-top';
    const name = document.createElement('strong');
    name.textContent = person.title;
    const pct = document.createElement('span');
    pct.textContent = `${deterministicPercent(person.title, rank)}%`;
    top.append(name, pct);

    const sub = document.createElement('small');
    sub.textContent = 'entertainment vibe match';
    body.append(top, sub);
    article.append(media, body);
    return article;
  }

  async function loadSet() {
    const category = selectedCategory();
    const allNames = namesForCategory(category);
    const pageSize = 6;
    const names = Array.from({ length: Math.min(pageSize, allNames.length) }, (_, i) => allNames[(offset + i) % allNames.length]);

    label.textContent = category === 'women'
      ? 'Showing women celebrity-style inspirations you selected.'
      : category === 'men'
        ? 'Showing men celebrity-style inspirations you selected.'
        : 'Showing a mixed set of celebrity-style inspirations.';

    status.textContent = 'Loading your entertainment matches…';
    refresh.disabled = true;

    try {
      const params = new URLSearchParams({
        origin: '*', action: 'query', format: 'json', redirects: '1', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '500', titles: names.join('|')
      });
      const response = await fetch(`${API}?${params.toString()}`);
      if (!response.ok) throw new Error('Celebrity images unavailable');
      const data = await response.json();
      const pages = Object.values(data?.query?.pages || {}).filter((p) => !p.missing);
      const order = new Map(names.map((name, i) => [name, i]));
      pages.sort((a, b) => (order.get(a.title) ?? 999) - (order.get(b.title) ?? 999));
      grid.replaceChildren();
      pages.forEach((person, i) => grid.appendChild(card(person, i)));
      status.textContent = `${pages.length} celebrity-style inspirations shown`;
    } catch (error) {
      console.warn(error);
      status.textContent = 'Could not load celebrity images right now.';
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', () => {
    offset += 6;
    loadSet();
  });

  document.querySelectorAll('input[name="celebrity-category"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      offset = 0;
      loadSet();
    });
  });

  window.FaceRevealCelebrityMatches = { loadSet };
  loadSet();
})();
