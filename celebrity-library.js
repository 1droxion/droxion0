(() => {
  const GROUPS = {
    women: ['Taylor Swift','Zendaya','Selena Gomez','Ariana Grande','Rihanna','Beyoncé','Margot Robbie','Priyanka Chopra Jonas','Deepika Padukone','Alia Bhatt','Lisa (rapper)','Jennie (singer)'],
    men: ['Dwayne Johnson','Chris Hemsworth','Leonardo DiCaprio','Tom Holland','Shah Rukh Khan','Ranveer Singh','Hrithik Roshan','Jungkook','V (singer)','Cristiano Ronaldo','Lionel Messi','Bad Bunny']
  };

  const API = 'https://en.wikipedia.org/w/api.php';
  let requestId = 0;

  function selectedCategory() {
    return document.querySelector('input[name="celebrity-category"]:checked')?.value || 'all';
  }

  function namesForCategory(category) {
    if (category === 'women') return GROUPS.women;
    if (category === 'men') return GROUPS.men;
    return [...GROUPS.women, ...GROUPS.men];
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function clearImage(id) {
    const img = document.getElementById(id);
    if (!img) return;
    img.removeAttribute('src');
    img.classList.remove('loaded');
  }

  function proxied(src) {
    return `/api/celebrity-image?url=${encodeURIComponent(src)}`;
  }

  function setImage(id, src) {
    const img = document.getElementById(id);
    if (!img) return;
    img.classList.remove('loaded');
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => img.classList.remove('loaded');
    img.src = proxied(src);
  }

  function resetResultSlots() {
    setText('match-status', 'Finding your closest match…');
    setText('top-match-percent', '—');
    setText('top-match-name', 'Finding match…');
    setText('match-2-name', 'Finding match…');
    setText('match-2-percent', '—');
    setText('match-3-name', 'Finding match…');
    setText('match-3-percent', '—');
    clearImage('top-match-photo');
    clearImage('match-2-photo');
    clearImage('match-3-photo');
  }

  async function fetchCelebrityPhotos(names, signal) {
    const params = new URLSearchParams({
      origin: '*', action: 'query', format: 'json', redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '640', titles: names.join('|')
    });

    const response = await fetch(`${API}?${params.toString()}`, { signal, cache: 'force-cache' });
    if (!response.ok) throw new Error('Celebrity photo lookup failed');

    const data = await response.json();
    return Object.values(data?.query?.pages || {})
      .filter((page) => !page.missing && page.thumbnail?.source)
      .map((page) => ({ name: page.title, photo: page.thumbnail.source }));
  }

  function loadImage(src, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => { cleanup(); reject(new Error('Image timeout')); }, timeoutMs);
      const cleanup = () => clearTimeout(timer);
      img.decoding = 'async';
      img.onload = () => { cleanup(); resolve(img); };
      img.onerror = () => { cleanup(); reject(new Error('Image load failed')); };
      img.src = proxied(src);
    });
  }

  async function comparePerson(person, api, userGeometry) {
    try {
      const img = await loadImage(person.photo);
      const geometry = await api.analyzeGeometry(img);
      if (!geometry) return null;
      const raw = api.geometrySimilarity(userGeometry, geometry);
      if (!Number.isFinite(raw)) return null;
      return { ...person, raw };
    } catch (error) {
      console.warn('Celebrity compare failed', person.name, error);
      return null;
    }
  }

  function normalizeTopScores(results) {
    if (!results.length) return results;
    const sorted = [...results].sort((a, b) => b.raw - a.raw);
    const best = sorted[0].raw;
    const worst = sorted[sorted.length - 1].raw;
    const spread = Math.max(1, best - worst);

    return sorted.map((item, index) => {
      const relative = (item.raw - worst) / spread;
      const ceiling = 94 - index * 2;
      const floor = Math.max(63, 76 - index * 4);
      const percent = Math.round(floor + relative * (ceiling - floor));
      return { ...item, percent };
    });
  }

  function fillSlot(rank, result) {
    if (!result) return;
    if (rank === 1) {
      setText('top-match-name', result.name);
      setText('top-match-percent', `${result.percent}%`);
      setImage('top-match-photo', result.photo);
      return;
    }
    setText(`match-${rank}-name`, result.name);
    setText(`match-${rank}-percent`, `${result.percent}%`);
    setImage(`match-${rank}-photo`, result.photo);
  }

  async function loadTopMatches() {
    const thisRequest = ++requestId;
    resetResultSlots();

    const api = window.FaceRevealFaceGate;
    const userGeometry = window.FaceRevealUserGeometry;
    if (!api?.analyzeGeometry || !api?.geometrySimilarity || !userGeometry) {
      setText('match-status', 'Face measurements unavailable. Try the scan again.');
      return;
    }

    const category = selectedCategory();
    const names = namesForCategory(category);
    setText('match-status', `Comparing ${names.length} celebrity portraits…`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const people = await fetchCelebrityPhotos(names, controller.signal);
      if (thisRequest !== requestId) return;
      setText('match-status', `Measuring ${people.length} available portraits…`);

      const settled = await Promise.allSettled(people.map((person) => comparePerson(person, api, userGeometry)));
      if (thisRequest !== requestId) return;

      const measured = settled
        .map((entry) => entry.status === 'fulfilled' ? entry.value : null)
        .filter(Boolean);

      if (!measured.length) {
        setText('match-status', 'Could not measure celebrity portraits. Try again.');
        return;
      }

      const results = normalizeTopScores(measured).slice(0, 3);
      fillSlot(1, results[0]);
      fillSlot(2, results[1]);
      fillSlot(3, results[2]);
      setText('match-status', results.length >= 3 ? 'Top 3 resemblance matches ready' : `${results.length} measured matches ready`);
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('Top match lookup failed', error);
      if (thisRequest === requestId) setText('match-status', 'Could not finish the comparison. Try again.');
    } finally {
      clearTimeout(timer);
    }
  }

  document.querySelectorAll('input[name="celebrity-category"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      requestId += 1;
      resetResultSlots();
    });
  });

  window.FaceRevealCelebrityMatches = { loadSet: loadTopMatches };
})();
