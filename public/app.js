(function () {
  'use strict';

  var FCC = 'https://opendata.fcc.gov/resource/vakf-fz8e.json';
  var SVC = {
    cnam: { label: 'Caller name', sub: 'CNAM, up to 15 characters' },
    carrier: { label: 'Carrier & line type', sub: 'Current carrier after porting' }
  };
  var PROV = { telnyx: 'Telnyx', twilio: 'Twilio' };
  var LINE = { voip: 'VoIP', landline: 'Landline', mobile: 'Mobile', tollfree: 'Toll-free', other: 'Other' };
  var ERR = {
    budget_cap: 'Monthly cap reached. Raise it in settings, or wait for next month.',
    service_disabled: 'Turned off in settings.',
    provider_not_configured: 'No API key set for this provider.',
    provider_auth: 'The provider rejected the API key.',
    provider_timeout: 'The provider took too long to answer.',
    provider_error: 'Could not reach the provider.'
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = { config: null, providers: {}, spend: 0, toggles: load('rc.toggles', { cnam: true, carrier: true }), last: null, busy: false };

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v, d) { return '$' + Number(v || 0).toFixed(d == null ? 2 : d); }
  function price(v) { return '$' + String(+Number(v).toFixed(4)); }

  /* ---------- number ---------- */
  function digitsOf(input) {
    var d = String(input || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d) || d.slice(1, 3) === '11') return null;
    return d;
  }
  function dashed(d) { return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6); }
  function pretty(d) { return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }
  function pad15(s) { s = String(s).slice(0, 15); while (s.length < 15) s += ' '; return s; }
  function region(d) {
    var npa = d.slice(0, 3);
    var r = (window.RC_NPA || {})[npa];
    return (r || 'Unknown region') + ' · area code ' + npa;
  }

  /* ---------- server config ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    opts.credentials = 'same-origin';
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; });
    });
  }

  function loadConfig() {
    return api('/api/config', { method: 'GET' }).then(function (r) {
      if (r.status !== 200) {
        state.config = null;
        showApiNote(r.status === 403
          ? 'Paid lookups are unavailable: the sign-in check failed. Free checks still work.'
          : 'Paid lookups are unavailable right now. Free checks still work.');
      } else {
        state.config = r.body.config;
        state.providers = r.body.providers || {};
        state.spend = r.body.monthSpendUsd || 0;
        showApiNote('');
      }
      renderToggles(); renderSpend(); renderSettings();
    }).catch(function () {
      state.config = null;
      showApiNote('Paid lookups are unavailable offline. Free checks still work.');
      renderToggles(); renderSettings();
    });
  }
  function showApiNote(msg) { $('apiNote').textContent = msg; $('apiNote').hidden = !msg; }

  function renderSpend() {
    var el = $('spend');
    if (!state.config) { el.hidden = true; return; }
    var cap = state.config.monthlyCapUsd;
    var now = new Date();
    var mon = now.toLocaleString('en-US', { month: 'short' });
    el.textContent = mon + ' ' + money(state.spend) + ' / ' + money(cap);
    el.className = 'pill num' + (cap > 0 && state.spend / cap >= 0.9 ? ' hot' : '');
    el.hidden = false;
  }

  function renderToggles() {
    var html = '';
    ['cnam', 'carrier'].forEach(function (k) {
      if (!state.config) return;
      var sv = state.config.services[k];
      if (!sv.enabled) return;
      var ready = state.providers[sv.provider];
      var p = state.config.prices[sv.provider][k];
      html += '<label class="svc-row' + (ready ? '' : ' off') + '" for="t_' + k + '">' +
        '<input type="checkbox" id="t_' + k + '" data-k="' + k + '"' + (ready && state.toggles[k] ? ' checked' : '') + (ready ? '' : ' disabled') + '>' +
        '<span><span class="svc-name">' + SVC[k].label + '</span><span class="svc-sub">' + PROV[sv.provider] + ' · ' +
        (ready ? SVC[k].sub : 'no API key set') + '</span></span>' +
        '<span class="price num">' + price(p) + '</span></label>';
    });
    html += '<div class="svc-row off"><input type="checkbox" checked disabled aria-label="FCC complaints, always on">' +
      '<span><span class="svc-name">FCC complaint history</span><span class="svc-sub">Open data, queried from this page</span></span><span class="price free">free</span></div>';
    html += '<div class="svc-row off"><input type="checkbox" checked disabled aria-label="Search links, always on">' +
      '<span><span class="svc-name">Search links</span><span class="svc-sub">One tap to web results</span></span><span class="price free">free</span></div>';
    $('svcRows').innerHTML = html;
  }
  $('svcRows').addEventListener('change', function (e) {
    var k = e.target.getAttribute('data-k');
    if (!k) return;
    state.toggles[k] = e.target.checked;
    save('rc.toggles', state.toggles);
  });

  function paidServices() {
    if (!state.config) return [];
    return ['cnam', 'carrier'].filter(function (k) {
      var sv = state.config.services[k];
      return sv.enabled && state.providers[sv.provider] && state.toggles[k];
    });
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    var box = $('setRows');
    if (!state.config) { box.innerHTML = '<p class="note">Settings load once paid lookups are available.</p>'; $('cap').value = ''; return; }
    box.innerHTML = ['cnam', 'carrier'].map(function (k) {
      var sv = state.config.services[k];
      var opts = Object.keys(PROV).map(function (p) {
        return '<option value="' + p + '"' + (sv.provider === p ? ' selected' : '') + '>' + PROV[p] + (state.providers[p] ? '' : ' (no key)') + '</option>';
      }).join('');
      return '<div class="set-row"><input type="checkbox" id="s_en_' + k + '"' + (sv.enabled ? ' checked' : '') + ' aria-label="Enable ' + SVC[k].label + '">' +
        '<label for="s_en_' + k + '">' + SVC[k].label + '</label>' +
        '<select id="s_pr_' + k + '" aria-label="Provider for ' + SVC[k].label + '">' + opts + '</select></div>';
    }).join('');
    $('cap').value = state.config.monthlyCapUsd;
  }
  $('setForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.config) return;
    var patch = { services: {}, monthlyCapUsd: Number($('cap').value) };
    ['cnam', 'carrier'].forEach(function (k) {
      patch.services[k] = { enabled: $('s_en_' + k).checked, provider: $('s_pr_' + k).value };
    });
    $('setStatus').textContent = 'Saving…';
    api('/api/config', { method: 'PUT', body: JSON.stringify(patch) }).then(function (r) {
      if (r.status === 200) {
        state.config = r.body.config;
        $('setStatus').textContent = 'Saved.';
        renderToggles(); renderSpend(); renderSettings();
      } else {
        $('setStatus').textContent = 'Not saved: ' + ((r.body.details || []).join('; ') || r.body.error || 'error ' + r.status);
      }
    }).catch(function () { $('setStatus').textContent = 'Not saved: no connection.'; });
  });

  /* ---------- FCC ---------- */
  function fccQuery(d) {
    var n = dashed(d);
    var tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    var where = "(caller_id_number='" + n + "' OR advertiser_business_phone_number='" + n + "') AND issue_date < '" + tomorrow + "'";
    var q1 = FCC + '?$select=' + encodeURIComponent('count(*) AS n, max(issue_date) AS last') + '&$where=' + encodeURIComponent(where);
    var q2 = FCC + '?$select=' + encodeURIComponent('type_of_call_or_messge AS t, count(*) AS n') + '&$group=type_of_call_or_messge&$where=' + encodeURIComponent(where);
    return Promise.all([fetch(q1).then(function (r) { return r.json(); }), fetch(q2).then(function (r) { return r.json(); })])
      .then(function (res) {
        var count = Number((res[0][0] || {}).n || 0);
        var last = (res[0][0] || {}).last || null;
        var types = (res[1] || []).filter(function (x) { return x.t; })
          .sort(function (a, b) { return b.n - a.n; })
          .map(function (x) { return x.t + ' ' + x.n; }).join(' · ');
        return { ok: true, count: count, last: last, types: types };
      })
      .catch(function () { return { ok: false }; });
  }

  /* ---------- lookup ---------- */
  function lookup(refresh) {
    var d = digitsOf($('num').value);
    if (!d) {
      $('result').innerHTML = '<div class="alert">That isn\'t a 10-digit US number. Check the digits and try again.</div>';
      return;
    }
    if (state.busy) return;
    state.busy = true;
    $('go').disabled = true;
    $('num').value = pretty(d);
    try { history.replaceState(null, '', '/?n=' + d); } catch (e) { /* ignore */ }
    $('result').innerHTML = '<div class="empty">Looking up ' + esc(pretty(d)) + '…</div>';

    var services = paidServices();
    var paid = services.length
      ? api('/api/lookup', { method: 'POST', body: JSON.stringify({ number: d, services: services, refresh: refresh === true }) })
          .catch(function () { return { status: 0, body: {} }; })
      : Promise.resolve(null);

    Promise.all([fccQuery(d), paid]).then(function (res) {
      var fcc = res[0], p = res[1];
      var body = p && p.status === 200 ? p.body : null;
      if (body) { state.spend = body.monthSpendUsd; renderSpend(); }
      state.last = { d: d, fcc: fcc, paid: body, paidStatus: p ? p.status : null, services: services };
      render(state.last);
      remember(d, state.last);
    }).finally(function () {
      state.busy = false;
      $('go').disabled = false;
    });
  }

  function verdict(fcc, paid) {
    var c = fcc.ok ? fcc.count : 0;
    var line = paid && paid.carrier && paid.carrier.lineType;
    var biz = paid && paid.cnam && paid.cnam.callerType === 'business';
    if (c >= 3) return ['v-bad', 'Likely spam'];
    if (c >= 1 || (line === 'voip' && !biz)) return ['v-warn', 'Be careful'];
    if (biz) return ['v-ok', 'Looks legit'];
    return ['v-none', 'No red flags'];
  }

  function srcTag(part) {
    if (!part) return '';
    return part.cached ? '<span class="src cached">cached · $0</span>' : '<span class="src">' + esc(PROV[part.provider] || part.provider) + '</span>';
  }
  function errFor(paid, k) {
    var e = paid && (paid.errors || []).filter(function (x) { return x.service === k; })[0];
    return e ? (ERR[e.code] || ('Provider error (' + e.code + ').')) : null;
  }
  function when(iso) {
    if (!iso) return '';
    var dt = new Date(iso);
    return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function render(r) {
    var d = r.d, fcc = r.fcc, paid = r.paid;
    var v = verdict(fcc, paid);
    var cn = paid && paid.cnam;
    var ca = paid && paid.carrier;
    var nameLine = cn ? (cn.name || 'NO NAME ON FILE') : (r.services.indexOf('cnam') >= 0 ? 'NAME UNAVAILABLE' : 'NAME LOOKUP OFF');
    var h = '';
    h += '<div class="lcd" role="img" aria-label="Caller ID: ' + esc(cn && cn.name ? cn.name : 'no name') + ', ' + dashed(d) + '">' +
      '<div class="lcd-top"><span>CALLER ID</span><span>' + (cn ? (cn.cached ? 'CACHED' : 'NEW') : '') + '</span></div>' +
      '<div class="lcd-name' + (cn && cn.name ? '' : ' dim') + '">' + esc(pad15(nameLine)) + '</div>' +
      '<div class="lcd-num">' + dashed(d) + '</div></div>';
    h += '<span class="verdict ' + v[0] + '">' + v[1] + '</span>';
    if (r.paidStatus !== null && r.paidStatus !== 200) {
      h += '<div class="alert soft">Paid lookups failed' + (r.paidStatus === 403 ? ': the sign-in check failed.' : '.') + ' Showing free results.</div>';
    }
    if (paid && (paid.errors || []).some(function (e) { return e.code === 'budget_cap'; })) {
      h += '<div class="alert">' + ERR.budget_cap + '</div>';
    }
    h += '<dl class="facts">';
    var cnErr = errFor(paid, 'cnam');
    h += '<dt>Caller name</dt><dd>' + (cn
      ? (cn.name ? '<span class="mono">' + esc(cn.name) + '</span>' : '<span class="off-txt">None on file</span>') +
        (cn.callerType ? ' <span class="muted">(' + esc(cn.callerType) + ')</span>' : '') + ' ' + srcTag(cn)
      : '<span class="off-txt">' + esc(cnErr && cnErr !== ERR.budget_cap ? cnErr : 'Off for this lookup') + '</span>') + '</dd>';
    var caErr = errFor(paid, 'carrier');
    h += '<dt>Carrier</dt><dd>' + (ca
      ? esc(ca.name || 'Unknown') + (ca.ported ? ' <span class="muted">(ported)</span>' : '') + ' ' + srcTag(ca)
      : '<span class="off-txt">' + esc(caErr && caErr !== ERR.budget_cap ? caErr : 'Off for this lookup') + '</span>') + '</dd>';
    var npa = d.slice(0, 3);
    var tf = (window.RC_NPA || {})[npa] === 'Toll-free';
    h += '<dt>Line type</dt><dd>' + (ca && ca.lineType ? esc(LINE[ca.lineType] || ca.lineType)
      : (tf ? 'Toll-free' : 'Fixed line or mobile <span class="muted">(needs carrier lookup)</span>')) + '</dd>';
    h += '<dt>Region</dt><dd>' + esc(region(d)) + ' <span class="src">free</span></dd>';
    h += '<dt>FCC reports</dt><dd>' + (!fcc.ok ? '<span class="off-txt">FCC data unavailable right now</span>'
      : fcc.count ? '<b class="num">' + fcc.count + '</b> complaint' + (fcc.count > 1 ? 's' : '') + (fcc.last ? ', last ' + esc(when(fcc.last)) : '') +
        (fcc.types ? '<span class="muted">' + esc(fcc.types) + '</span>' : '')
      : 'None on file') + ' <span class="src">free</span></dd>';
    h += '</dl>';
    var q = encodeURIComponent('"' + dashed(d) + '"');
    h += '<div class="links">' +
      '<a href="https://www.google.com/search?q=' + q + '" target="_blank" rel="noopener noreferrer">Google</a>' +
      '<a href="https://duckduckgo.com/?q=' + q + '" target="_blank" rel="noopener noreferrer">DuckDuckGo</a>' +
      '<a href="https://800notes.com/Phone.aspx/1-' + dashed(d) + '" target="_blank" rel="noopener noreferrer">800notes</a></div>';
    var receipt = paid ? 'This lookup: ' + money(paid.costUsd, 4) : (r.services.length ? 'Paid lookups unavailable' : 'Free checks only');
    h += '<div class="receipt num"><span>' + receipt + '</span>' +
      (paid && (cn || ca) ? '<button class="ghost" type="button" id="refresh">Refresh paid data</button>' : '') + '</div>';
    $('result').innerHTML = h;
    var rb = $('refresh');
    if (rb) rb.addEventListener('click', function () { lookup(true); });
  }

  /* ---------- history ---------- */
  function remember(d, r) {
    var list = load('rc.history', []).filter(function (x) { return x.d !== d; });
    var v = verdict(r.fcc, r.paid);
    list.unshift({ d: d, at: Date.now(), v: v[0], label: v[1], name: r.paid && r.paid.cnam && r.paid.cnam.name || '' });
    save('rc.history', list.slice(0, 20));
    renderHistory();
  }
  function renderHistory() {
    var list = load('rc.history', []);
    $('histEmpty').hidden = list.length > 0;
    $('clearHist').hidden = list.length === 0;
    $('hist').innerHTML = list.map(function (x) {
      return '<li><button type="button" data-d="' + esc(x.d) + '"><span class="dot ' + esc(x.v) + '"></span>' +
        '<span><span class="mono">' + esc(pretty(x.d)) + '</span>' + (x.name ? ' <span class="muted">' + esc(x.name) + '</span>' : '') + '</span>' +
        '<span class="when">' + esc(new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</span></button></li>';
    }).join('');
  }
  $('hist').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-d]');
    if (!b) return;
    $('num').value = b.getAttribute('data-d');
    lookup(false);
  });
  $('clearHist').addEventListener('click', function () { save('rc.history', []); renderHistory(); });

  /* ---------- wiring ---------- */
  $('form').addEventListener('submit', function (e) { e.preventDefault(); lookup(false); });
  $('num').addEventListener('paste', function () { setTimeout(function () { if (digitsOf($('num').value)) lookup(false); }, 0); });
  document.addEventListener('paste', function (e) {
    if (e.target === $('num') || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (digitsOf(text)) { $('num').value = text; lookup(false); }
  });

  renderHistory();
  renderToggles();
  loadConfig().then(function () {
    var n = new URLSearchParams(location.search).get('n');
    if (n) { $('num').value = n; lookup(false); }
  });
})();
