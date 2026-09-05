(() => {
  const FEATURED_CELEBRITIES = [
    'Taylor Swift',
    'Zendaya',
    'Selena Gomez',
    'Ariana Grande',
    'Rihanna',
    'Beyoncé',
    'Dwayne Johnson',
    'Chris Hemsworth',
    'Leonardo DiCaprio',
    'Tom Holland',
    'Margot Robbie',
    'Priyanka Chopra Jonas',
    'Shah Rukh Khan',
    'Deepika Padukone',
    'Ranveer Singh',
    'Alia Bhatt',
    'Hrithik Roshan',
    'Jungkook',
    'V (singer)',
    'Lisa (rapper)',
    'Jennie (singer)',
    'Cristiano Ronaldo',
    'Lionel Messi',
    'Bad Bunny'
  ];

  const API = 'https://en.wikipedia.org/w/api.php';
  const grid = document.getElementById('celebrity-grid');
  const input = document.getElementById('celebrity-search');
  const button = document.getElementById('celebrity-search-btn');
  const status = document.getElementById('celebrity-status');

  if (!grid || !input || !button || !status) return;

  function setStatus(message) {
    status.textContent = message;
  }

  function makeCard(person) {
    const card = document.createElement('article');
    card.className = 'celebrity-card';

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
      fallback.textContent = person.title
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase();
      media.appendChild(fallback);
    }

    const name = document.createElement('strong');
    name.textContent = person.title;

    const source = document.createElement('small');
    source.textContent = 'Wikipedia / Wikimedia';

    card.append(media, name, source);
    return card;
  }

  function renderPeople(people) {
    grid.replaceChildren();
    people.forEach((person) => grid.appendChild(makeCard(person)));
    setStatus(people.length ? `${people.length} celebrity images shown` : 'No celebrity images found.');
  }

  async function fetchFeatured() {
    setStatus('Loading global celebrity images…');
    const params = new URLSearchParams({
      origin: '*',
      action: 'query',
      format: 'json',
      redirects: '1',
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: '500',
      titles: FEATURED_CELEBRITIES.join('|')
    });

    const response = await fetch(`${API}?${params.toString()}`);
    if (!response.ok) throw new Error('Celebrity library request failed');
    const data = await response.json();
    const pages = Object.values(data?.query?.pages || {})
      .filter((page) => !page.missing)
      .sort((a, b) => FEATURED_CELEBRITIES.indexOf(a.title) - FEATURED_CELEBRITIES.indexOf(b.title));
    renderPeople(pages);
  }

  async function searchCelebrities() {
    const query = input.value.trim();
    if (!query) {
      await fetchFeatured();
      return;
    }

    button.disabled = true;
    setStatus(`Searching “${query}”…`);

    try {
      const params = new URLSearchParams({
        origin: '*',
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: `${query} incategory:Living_people`,
        gsrlimit: '18',
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: '500'
      });

      const response = await fetch(`${API}?${params.toString()}`);
      if (!response.ok) throw new Error('Celebrity search failed');
      const data = await response.json();
      const pages = Object.values(data?.query?.pages || {})
        .sort((a, b) => (a.index || 999) - (b.index || 999));
      renderPeople(pages);
    } catch (error) {
      console.warn(error);
      setStatus('Could not load celebrity images right now. Try again.');
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', searchCelebrities);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchCelebrities();
  });

  fetchFeatured().catch((error) => {
    console.warn(error);
    setStatus('Could not load the celebrity library right now.');
  });
})();
