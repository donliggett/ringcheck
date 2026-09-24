import { verifyAccess } from './access.js';
import { getConfig, saveConfig, providerAvailability } from './config.js';
import { getSpend, monthKey } from './budget.js';
import { runLookup } from './lookup.js';

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: API_HEADERS });
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) return { error: 'expected_json' };
  const text = await request.text();
  if (text.length > 10_000) return { error: 'body_too_large' };
  try { return { value: JSON.parse(text || '{}') }; } catch { return { error: 'invalid_json' }; }
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}

export async function handleApi(request, env, deps = {}) {
  const url = new URL(request.url);
  const auth = await (deps.verify || verifyAccess)(request, env);
  if (!auth.ok) return json({ error: 'forbidden', reason: auth.reason }, 403);
  if (!sameOrigin(request, url)) return json({ error: 'forbidden', reason: 'cross_origin' }, 403);

  if (url.pathname === '/api/config' && request.method === 'GET') {
    const config = await getConfig(env);
    return json({
      config,
      providers: providerAvailability(env),
      month: monthKey().slice(6),
      monthSpendUsd: await getSpend(env),
      user: auth.email || null,
    });
  }

  if (url.pathname === '/api/config' && request.method === 'PUT') {
    const body = await readJson(request);
    if (body.error) return json({ error: body.error }, 400);
    const saved = await saveConfig(env, body.value);
    if (!saved.ok) return json({ error: 'invalid_config', details: saved.errors }, 400);
    return json({ config: saved.config });
  }

  if (url.pathname === '/api/lookup' && request.method === 'POST') {
    const body = await readJson(request);
    if (body.error) return json({ error: body.error }, 400);
    const r = await runLookup(env, body.value, { fetchImpl: deps.fetchImpl });
    return json(r.body, r.status);
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env);
    } catch (e) {
      console.error('ringcheck api error', e && e.stack ? e.stack : e);
      return json({ error: 'server_error' }, 500);
    }
  },
};
