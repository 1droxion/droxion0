(() => {
  let entitlement = null;
  let pending = null;

  async function refresh() {
    if (pending) return pending;
    pending = fetch('/api/access-status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        entitlement = Boolean(response.ok && data.entitled);
        window.FaceRevealEntitled = entitlement;
        return entitlement;
      })
      .catch(() => {
        entitlement = false;
        window.FaceRevealEntitled = false;
        return false;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  async function isEntitled() {
    if (entitlement !== null) return entitlement;
    return refresh();
  }

  function grantLocal() {
    entitlement = true;
    window.FaceRevealEntitled = true;
  }

  window.FaceRevealAccess = { isEntitled, refresh, grantLocal };
  refresh();
})();
