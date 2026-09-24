// Twilio Lookup v2: GET /v2/PhoneNumbers/{e164}?Fields=caller_name,line_type_intelligence
// One request covers every requested field; Twilio bills each field.

const BASE = 'https://lookups.twilio.com/v2/PhoneNumbers/';
const FIELD = { cnam: 'caller_name', carrier: 'line_type_intelligence' };

const LINE = {
  mobile: 'mobile',
  landline: 'landline',
  fixedVoip: 'voip',
  nonFixedVoip: 'voip',
  tollFree: 'tollfree',
};

export function mapTwilio(service, body) {
  if (service === 'cnam') {
    const c = (body && body.caller_name) || {};
    const n = c.caller_name ? String(c.caller_name).trim() : '';
    const t = c.caller_type ? String(c.caller_type).toLowerCase() : null;
    return { name: n || null, callerType: t === 'business' || t === 'consumer' ? t : null };
  }
  const l = (body && body.line_type_intelligence) || {};
  const raw = l.type || null;
  return {
    name: l.carrier_name || null,
    lineType: raw ? (LINE[raw] || 'other') : null,
    raw,
    ported: null,
  };
}

function basic(sid, token) {
  return 'Basic ' + btoa(`${sid}:${token}`);
}

export async function twilioLookup(e164, services, env, fetchImpl = fetch) {
  const out = { results: {}, errors: {}, billed: [] };
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    for (const s of services) out.errors[s] = 'provider_not_configured';
    return out;
  }
  const fields = services.map((s) => FIELD[s]).join(',');
  try {
    const res = await fetchImpl(`${BASE}${encodeURIComponent(e164)}?Fields=${fields}`, {
      headers: { Authorization: basic(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN), Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      for (const s of services) out.errors[s] = 'provider_auth';
      return out;
    }
    if (!res.ok) {
      for (const s of services) out.errors[s] = `provider_http_${res.status}`;
      return out;
    }
    const body = await res.json();
    for (const s of services) {
      out.results[s] = mapTwilio(s, body);
      out.billed.push(s);
    }
  } catch (e) {
    for (const s of services) out.errors[s] = e && e.name === 'TimeoutError' ? 'provider_timeout' : 'provider_error';
  }
  return out;
}
