/* Read-only Pera Compass bridge. No credentials, DOB or source account data leave this app. */
(() => {
  'use strict';
  const PERA = 'https://pera-compass.ajmillertperez562.chatgpt.site';
  const GRANT = 'pera-bridge-approval:v1';
  const EDITED = 'crp:financial-inputs-edited:v1';
  let pending = null;
  let panel, status, connectButton, revokeButton;
  const storage = {
    read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
  };
  const approved = () => {
    const grant = storage.read(GRANT);
    return grant?.origin === PERA && grant.source === 'reserve' && grant.currency === 'USD';
  };
  // compute() saves default examples too. A real browser input event is separate
  // evidence of an intentional financial edit, rather than an initial page load.
  for (const name of ['spend', 'spendPeriod', 'assets']) {
    document.getElementById(name)?.addEventListener('input', event => {
      if (!event.isTrusted) return;
      const flags = storage.read(EDITED) || {};
      flags[name === 'spendPeriod' ? 'spend' : name] = true;
      storage.write(EDITED, flags);
    });
    document.getElementById(name)?.addEventListener('change', event => {
      if (!event.isTrusted) return;
      const flags = storage.read(EDITED) || {};
      flags[name === 'spendPeriod' ? 'spend' : name] = true;
      storage.write(EDITED, flags);
    });
  }
  function snapshot() {
    const saved = storage.read('crp');
    const flags = storage.read(EDITED) || {};
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    const spend = Number(saved.spend), assets = Number(saved.assets);
    const hasSpend = saved.spend !== undefined && (flags.spend || String(saved.spend) !== '5000' || saved.spendPeriod === 'year');
    const hasAssets = saved.assets !== undefined && (flags.assets || String(saved.assets) !== '200000');
    const payload = {};
    if (hasSpend && Number.isFinite(spend) && spend >= 0 && spend <= 1e12) {
      const monthly = saved.spendPeriod === 'year' ? spend / 12 : spend;
      const label = document.getElementById('t-buffersub')?.textContent || '';
      const months = Number(label.match(/^(\d+)\s+months/)?.[1] || 24);
      if (Number.isFinite(months) && months >= 0 && months <= 120) payload.reserve = { monthly, months, currency: 'USD' };
    }
    payload.assetAssumption = hasAssets && Number.isFinite(assets) && assets >= 0 && assets <= 1e12 ? assets : null;
    if (!payload.reserve && payload.assetAssumption === null) return {};
    payload.currency = 'USD';
    return payload;
  }
  function respond() {
    if (!pending || !approved()) return;
    const payload = snapshot();
    pending.target.postMessage({
      type: 'pera-finance:snapshot', version: 1, requestId: pending.requestId,
      source: 'reserve', generatedAt: new Date().toISOString(),
      status: Object.keys(payload).length ? 'ready' : 'no-data', payload,
    }, PERA);
    if (status) status.textContent = Object.keys(payload).length
      ? 'Connected to Pera Compass. Saved USD assumptions refresh automatically while both tabs are open. No currency conversion is performed.'
      : 'Connected, but no edited financial assumptions were found. Default example amounts are not shared. Edit spending or reserve assets to share your own USD assumptions.';
  }
  function showPanel() {
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'pera-reserve-connection';
      panel.setAttribute('aria-label', 'Pera Compass connection');
      panel.style.cssText = 'position:relative;z-index:30;background:#173e35;color:#fff8e7;padding:18px 22px;font:14px/1.6 system-ui;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:2px solid #cbb27a';
      status = document.createElement('span');
      status.setAttribute('role', 'status');
      status.style.cssText = 'flex:1;min-width:240px';
      connectButton = document.createElement('button');
      connectButton.type = 'button';
      connectButton.textContent = 'Connect USD assumptions to Pera Compass';
      connectButton.style.cssText = 'border:1px solid #d9c7a4;border-radius:7px;padding:10px 14px;background:#fff7e4;color:#173e35;cursor:pointer;font:600 13px system-ui';
      connectButton.addEventListener('click', () => {
        if (!storage.write(GRANT, { origin: PERA, source: 'reserve', currency: 'USD' })) {
          status.textContent = 'This browser could not save connection permission. No data was shared.'; return;
        }
        connectButton.hidden = true; revokeButton.hidden = false; respond();
      });
      revokeButton = document.createElement('button');
      revokeButton.type = 'button'; revokeButton.textContent = 'Disconnect Pera Compass';
      revokeButton.style.cssText = connectButton.style.cssText;
      revokeButton.addEventListener('click', () => {
        storage.remove(GRANT); connectButton.hidden = false; revokeButton.hidden = true;
        status.textContent = 'Disconnected. This app will not share new assumptions with Pera Compass. Previously imported snapshots must be removed in Pera Compass.';
        pending?.target.postMessage({ type: 'pera-finance:status', version: 1, requestId: pending.requestId, source: 'reserve', status: 'revoked' }, PERA);
      });
      panel.append(status, connectButton, revokeButton); document.body.prepend(panel);
    }
    connectButton.hidden = approved(); revokeButton.hidden = !approved();
    if (!approved()) status.textContent = 'Pera Compass requests your saved reserve assumptions. This source uses USD ($), not PHP. Connecting shares only edited spending, target months, and reserve-asset assumptions—not your birthday, Google identity, or tokens. It never changes your records or converts currency.';
  }
  window.addEventListener('message', event => {
    // The first-party source popup is the only bridge surface. No arbitrary
    // frames, opener substitutes, or other origins can obtain these values.
    if (event.origin !== PERA || !window.opener || event.source !== window.opener || window.top !== window) return;
    const data = event.data;
    if (!data || data.type !== 'pera-finance:request' || data.version !== 1 || typeof data.requestId !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(data.requestId)) return;
    pending = { target: event.source, requestId: data.requestId };
    showPanel();
    if (approved()) respond();
    else event.source.postMessage({ type: 'pera-finance:status', version: 1, requestId: data.requestId, source: 'reserve', status: 'consent-required' }, PERA);
  });
})();
