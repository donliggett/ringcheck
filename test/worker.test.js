import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toE164 } from '../src/number.js';
import { mergeConfig, DEFAULT_CONFIG, saveConfig, getConfig } from '../src/config.js';
import { runLookup } from '../src/lookup.js';
import { handleApi } from '../src/index.js';
import { verifyAccess } from '../src/access.js';
import { monthKey } from '../src/budget.js';
import { makeEnv, mockFetch, TELNYX_CNAM, TELNYX_CARRIER, TWILIO_BOTH } from './helpers.js';

const NUM = '(202) 555-0187';
const E164 = '+12025550187';
const telnyxRoutes = () => [['type=caller-name', TELNYX_CNAM], ['type=carrier', TELNYX_CARRIER]];

test('toE164 accepts common formats and rejects bad ones', () => {
  assert.equal(toE164('202-555-0187'), E164);
  assert.equal(toE164('+1 (202) 555-0187'), E164);
  assert.equal(toE164('12025550187'), E164);
  assert.equal(toE164('2025550'), null);
  assert.equal(toE164('0155550187'), null);   // NPA can't start with 0/1
  assert.equal(toE164('2021550187'), null);   // NXX can't start with 1
  assert.equal(toE164('4115550187'), null);   // N11
  assert.equal(toE164(null), null);
});

test('mergeConfig keeps valid values and reports invalid ones', () => {
  const r = mergeConfig(DEFAULT_CONFIG, { services: { cnam: { provider: 'twilio', enabled: 'yes' } }, monthlyCapUsd: -1, bogus: 1 });
  assert.equal(r.config.services.cnam.provider, 'twilio');
  assert.equal(r.config.services.cnam.enabled, true);
  assert.equal(r.config.monthlyCapUsd, 2);
  assert.equal(r.errors.length, 2);
  assert.equal(r.config.bogus, undefined);
});

test('first lookup calls Telnyx once per service, charges, and caches', async () => {
  const env = makeEnv();
  const f = mockFetch(telnyxRoutes());
  const r = await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  assert.equal(r.status, 200);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].init.headers.Authorization, /^Bearer test-telnyx$/);
  assert.equal(r.body.cnam.name, 'ACME PLUMBING');
  assert.equal(r.body.cnam.cached, false);
  assert.equal(r.body.carrier.name, 'Bandwidth');
  assert.equal(r.body.carrier.lineType, 'voip');
  assert.equal(r.body.carrier.ported, true);
  assert.equal(r.body.costUsd, 0.0055);
  assert.equal(r.body.monthSpendUsd, 0.0055);
  const cachePut = env.RINGCHECK_KV.puts.find((p) => p.key === `c:cnam:${E164}`);
  assert.equal(cachePut.opts.expirationTtl, 30 * 86400);
});

test('repeat lookup is served from cache at $0; refresh pays again', async () => {
  const env = makeEnv();
  const f = mockFetch(telnyxRoutes());
  await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  const again = await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  assert.equal(f.calls.length, 2);
  assert.equal(again.body.costUsd, 0);
  assert.equal(again.body.cnam.cached, true);
  const fresh = await runLookup(env, { number: NUM, services: ['cnam'], refresh: true }, { fetchImpl: f });
  assert.equal(f.calls.length, 3);
  assert.equal(fresh.body.costUsd, 0.003);
});

test('budget cap blocks uncached calls but still returns cached ones', async () => {
  const env = makeEnv();
  const f = mockFetch(telnyxRoutes());
  await runLookup(env, { number: NUM, services: ['cnam'] }, { fetchImpl: f });
  await saveConfig(env, { monthlyCapUsd: 0 });
  const r = await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.equal(r.body.cnam.cached, true);
  assert.equal(r.body.carrier, undefined);
  assert.deepEqual(r.body.errors, [{ service: 'carrier', code: 'budget_cap' }]);
});

test('disabled services are refused without a provider call', async () => {
  const env = makeEnv();
  await saveConfig(env, { services: { cnam: { enabled: false } } });
  const f = mockFetch(telnyxRoutes());
  const r = await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.includes('type=carrier'));
  assert.deepEqual(r.body.errors, [{ service: 'cnam', code: 'service_disabled' }]);
});

test('switching provider to Twilio needs only a config change', async () => {
  const env = makeEnv();
  await saveConfig(env, { services: { cnam: { provider: 'twilio' }, carrier: { provider: 'twilio' } } });
  const f = mockFetch([['lookups.twilio.com', TWILIO_BOTH]]);
  const r = await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith('?Fields=caller_name,line_type_intelligence'));
  assert.equal(f.calls[0].init.headers.Authorization, 'Basic ' + btoa('ACtest:secret'));
  assert.equal(r.body.cnam.callerType, 'business');
  assert.equal(r.body.carrier.lineType, 'voip');
  assert.equal(r.body.costUsd, 0.018);
});

test('mixed providers: Telnyx name + Twilio carrier', async () => {
  const env = makeEnv();
  await saveConfig(env, { services: { carrier: { provider: 'twilio' } } });
  const f = mockFetch([['type=caller-name', TELNYX_CNAM], ['lookups.twilio.com', TWILIO_BOTH]]);
  const r = await runLookup(env, { number: NUM, services: ['cnam', 'carrier'] }, { fetchImpl: f });
  assert.equal(r.body.cnam.provider, 'telnyx');
  assert.equal(r.body.carrier.provider, 'twilio');
  assert.ok(f.calls.find((c) => c.url.includes('Fields=line_type_intelligence')));
  assert.equal(r.body.costUsd, 0.011);
});

test('missing provider key and provider errors are reported, not charged, not cached', async () => {
  const env = makeEnv({ TELNYX_API_KEY: '' });
  const f = mockFetch([]);
  const r = await runLookup(env, { number: NUM, services: ['cnam'] }, { fetchImpl: f });
  assert.equal(f.calls.length, 0);
  assert.equal(r.body.errors[0].code, 'provider_not_configured');
  assert.equal(r.body.costUsd, 0);

  const env2 = makeEnv();
  const f2 = mockFetch([['type=caller-name', { status: 401 }]]);
  const r2 = await runLookup(env2, { number: NUM, services: ['cnam'] }, { fetchImpl: f2 });
  assert.equal(r2.body.errors[0].code, 'provider_auth');
  assert.equal(r2.body.costUsd, 0);
  assert.equal(await env2.RINGCHECK_KV.get(`c:cnam:${E164}`), null);
});

test('spend is tracked per month', async () => {
  assert.equal(monthKey(new Date(Date.UTC(2026, 8, 30))), 'spend:2026-09');
  const env = makeEnv();
  const f = mockFetch(telnyxRoutes());
  await runLookup(env, { number: NUM, services: ['cnam'] }, { fetchImpl: f, now: new Date(Date.UTC(2026, 8, 30)) });
  const oct = await runLookup(env, { number: '202-555-0142', services: ['cnam'] }, { fetchImpl: f, now: new Date(Date.UTC(2026, 9, 1)) });
  assert.equal(oct.body.monthSpendUsd, 0.003);
});

test('invalid number returns 400', async () => {
  const r = await runLookup(makeEnv(), { number: '12345', services: ['cnam'] });
  assert.equal(r.status, 400);
});

test('Access check fails closed when not configured or token missing', async () => {
  const req = (h = {}) => new Request('https://rc.example.com/api/config', { headers: h });
  assert.equal((await verifyAccess(req(), { TEAM_DOMAIN: '__TEAM_DOMAIN__', POLICY_AUD: '__POLICY_AUD__' })).reason, 'access_not_configured');
  assert.equal((await verifyAccess(req(), { TEAM_DOMAIN: 'https://t.cloudflareaccess.com', POLICY_AUD: 'abc' })).reason, 'missing_token');
  // Dev bypass only works on localhost.
  assert.equal((await verifyAccess(req(), { DEV_BYPASS_ACCESS: 'true' })).ok, false);
  const local = new Request('http://localhost:8787/api/config');
  assert.equal((await verifyAccess(local, { DEV_BYPASS_ACCESS: 'true' })).ok, true);
});

test('API routes: auth, content type, origin, config round trip', async () => {
  const env = makeEnv();
  const ok = { verify: async () => ({ ok: true, email: 'me@example.com' }) };
  const deny = { verify: async () => ({ ok: false, reason: 'missing_token' }) };
  const base = 'https://rc.example.com';

  let res = await handleApi(new Request(`${base}/api/config`), env, deny);
  assert.equal(res.status, 403);

  res = await handleApi(new Request(`${base}/api/config`), env, ok);
  const cfg = await res.json();
  assert.equal(cfg.config.services.cnam.provider, 'telnyx');
  assert.deepEqual(cfg.providers, { telnyx: true, twilio: true });

  res = await handleApi(new Request(`${base}/api/config`, { method: 'PUT', body: '{"monthlyCapUsd":5}', headers: { 'content-type': 'text/plain' } }), env, ok);
  assert.equal(res.status, 400);

  res = await handleApi(new Request(`${base}/api/config`, { method: 'PUT', body: '{"monthlyCapUsd":5}', headers: { 'content-type': 'application/json', origin: 'https://evil.example' } }), env, ok);
  assert.equal(res.status, 403);

  res = await handleApi(new Request(`${base}/api/config`, { method: 'PUT', body: '{"monthlyCapUsd":5}', headers: { 'content-type': 'application/json', origin: base } }), env, ok);
  assert.equal(res.status, 200);
  assert.equal((await getConfig(env)).monthlyCapUsd, 5);

  const f = mockFetch(telnyxRoutes());
  res = await handleApi(new Request(`${base}/api/lookup`, { method: 'POST', body: JSON.stringify({ number: NUM, services: ['cnam'] }), headers: { 'content-type': 'application/json' } }), env, { ...ok, fetchImpl: f });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).cnam.name, 'ACME PLUMBING');
});
