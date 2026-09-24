import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cloudflare Access sits in front of the whole Worker. This check is a second
// lock: every /api request must carry a valid Access JWT for this app's AUD.

let jwks = null;
let jwksTeam = null;

const placeholder = (v) => !v || String(v).startsWith('__');

export async function verifyAccess(request, env) {
  const url = new URL(request.url);
  if (env.DEV_BYPASS_ACCESS === 'true' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return { ok: true, email: 'dev@localhost' };
  }

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

  const allowed = String(placeholder(env.ALLOWED_EMAILS) ? '' : env.ALLOWED_EMAILS)
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const email = String(payload.email || '').toLowerCase();
  if (allowed.length && !allowed.includes(email)) return { ok: false, reason: 'email_not_allowed' };

  return { ok: true, email };
}
