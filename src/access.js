import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cloudflare Access sits in front of the whole Worker. This check is a second
// lock on every /api request:
//
// 1. If Cloudflare hands the Worker ctx.access (Worker-level Access), trust it.
// 2. Otherwise verify the Cf-Access-Jwt-Assertion JWT against TEAM_DOMAIN and
//    POLICY_AUD (`setup.ps1 -DetectAccess` fills both in).

let jwks = null;
let jwksTeam = null;

const placeholder = (v) => !v || String(v).startsWith('__');

function emailAllowed(env, email) {
  const allowed = String(placeholder(env.ALLOWED_EMAILS) ? '' : env.ALLOWED_EMAILS)
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.includes(String(email || '').toLowerCase());
}

export async function verifyAccess(request, env, ctx) {
  const url = new URL(request.url);
  if (env.DEV_BYPASS_ACCESS === 'true' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return { ok: true, email: 'dev@localhost' };
  }

  // 1. Worker-level Access: present only when Access authenticated this request.
  if (ctx && ctx.access) {
    if (!placeholder(env.POLICY_AUD) && ctx.access.aud && ctx.access.aud !== env.POLICY_AUD) {
      return { ok: false, reason: 'wrong_audience' };
    }
    let identity = null;
    try { identity = await ctx.access.getIdentity(); } catch { identity = null; }
    const email = identity && identity.email ? String(identity.email).toLowerCase() : '';
    if (!emailAllowed(env, email)) return { ok: false, reason: 'email_not_allowed' };
    return { ok: true, email };
  }

  // 2. Hostname-based Access application: verify the JWT ourselves.
  const team = String(env.TEAM_DOMAIN || '').replace(/\/+$/, '');
  const aud = env.POLICY_AUD;
  if (placeholder(team) || !team.startsWith('https://') || placeholder(aud)) {
    return { ok: false, reason: 'access_not_configured' };
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, reason: 'missing_token' };

  if (!jwks || jwksTeam !== team) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksTeam = team;
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer: team, audience: aud }));
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }

  const email = String(payload.email || '').toLowerCase();
  if (!emailAllowed(env, email)) return { ok: false, reason: 'email_not_allowed' };
  return { ok: true, email };
}
