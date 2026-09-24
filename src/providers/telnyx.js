// Telnyx Number Lookup: GET /v2/number_lookup/{e164}?type=caller-name|carrier
// One request per service; each is billed separately by Telnyx.

const BASE = 'https://api.telnyx.com/v2/number_lookup/';
const TYPE = { cnam: 'caller-name', carrier: 'carrier' };

const LINE = {
  'fixed line': 'landline',
  'mobile': 'mobile',
  'voip': 'voip',
  'toll free': 'tollfree',
};

export function mapTelnyx(service, data) {
  if (service === 'cnam') {
    const n = data && data.caller_name && data.caller_name.caller_name;
    return { name: n ? String(n).trim() || null : null, callerType: null };
  }
  const c = (data && data.carrier) || {};
  const p = (data && data.portability) || {};
  const raw = c.type || null;
  return {
    name: c.normalized_carrier || c.name || null,
    lineType: raw ? (LINE[raw] || 'other') : null,
    raw,
    ported: p.ported_status === 'Y' ? true : p.ported_status === 'N' ? false : null,
  };
}

export async function telnyxLookup(e164, services, env, fetchImpl = fetch) {
  const out = { results: {}, errors: {}, billed: [] };
  if (!env.TELNYX_API_KEY) {
    for (const s of services) out.errors[s] = 'provider_not_configured';
    return out;
  }
  await Promise.all(services.map(async (s) => {
    try {
      const res = await fetchImpl(`${BASE}${encodeURIComponent(e164)}?type=${TYPE[s]}`, {
        headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403) { out.errors[s] = 'provider_auth'; return; }
      if (!res.ok) { out.errors[s] = `provider_http_${res.status}`; return; }
      const body = await res.json();
      out.results[s] = mapTelnyx(s, body.data);
      out.billed.push(s);
    } catch (e) {
      out.errors[s] = e && e.name === 'TimeoutError' ? 'provider_timeout' : 'provider_error';
    }
  }));
  return out;
}
