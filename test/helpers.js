export class MemoryKV {
  constructor() { this.map = new Map(); this.puts = []; }
  async get(key, type) {
    if (!this.map.has(key)) return null;
    const v = this.map.get(key);
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, value, opts) { this.map.set(key, value); this.puts.push({ key, opts }); }
}

export function makeEnv(extra = {}) {
  return {
    RINGCHECK_KV: new MemoryKV(),
    TELNYX_API_KEY: 'test-telnyx',
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: 'secret',
    ...extra,
  };
}

/** fetch mock that records calls and answers by URL substring. */
export function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) {
      if (String(url).includes(match)) {
        const r = typeof handler === 'function' ? handler(url, init) : handler;
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
      }
    }
    return new Response('{}', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

export const TELNYX_CNAM = { body: { data: { caller_name: { caller_name: 'ACME PLUMBING' } } } };
export const TELNYX_CARRIER = { body: { data: { carrier: { name: 'Bandwidth/1', normalized_carrier: 'Bandwidth', type: 'voip' }, portability: { ported_status: 'Y' } } } };
export const TWILIO_BOTH = { body: { caller_name: { caller_name: 'ACME CO', caller_type: 'BUSINESS' }, line_type_intelligence: { carrier_name: 'T-Mobile USA', type: 'nonFixedVoip' } } };
