# Setting up RingCheck

About 30 minutes, once. Commands are for Windows PowerShell 5.1 (one command
per line). On Linux, see [Linux](#linux).

## What you need

- A Cloudflare account with a domain using Cloudflare DNS (Workers custom
  domains require it).
- Node.js 20 or newer.
- A Telnyx account (API key) and/or a Twilio account (Account SID and Auth
  Token). You can start with neither: free checks work without them.

## 1. Clone and install

```powershell
git clone https://github.com/<you>/ringcheck.git
cd ringcheck
npm ci
npx wrangler login
```

## 2. Create your local config

Pick a hostname on your domain, e.g. `ringcheck.example.com`.

```powershell
.\setup.ps1 -Hostname ringcheck.example.com -CreateKv
```

This writes `wrangler.toml` (git-ignored) and creates the `RINGCHECK_KV`
namespace. The API refuses every request (403) until step 4 puts Access in
front of the Worker.

## 3. Deploy

```powershell
npx wrangler deploy
```

The page is live at your hostname. Do step 4 right away so nobody else can
open it.

## 4. Lock it with Cloudflare Access

In the Cloudflare dashboard:

1. **Zero Trust:** choose a team name and the Free plan (up to 50 users).
2. **Settings > Authentication:** keep **One-time PIN** as a login method.
3. **Workers & Pages > ringcheck > Access tab > Protect this Worker behind
   Access**, all traffic.
4. **Policy:** allow only yourself. The quick options there are
   *Cloudflare account members* or *Email domain*; for a single address,
   first create a policy in **Zero Trust > Access > Policies** with the
   selector **Emails**, then pick it here.
5. **Session duration:** 1 month, so the iPhone and desktop don't ask for a
   code every time.

Worker-level Access passes the signed-in identity to the Worker directly, so
there is no AUD tag to copy. (Using a hostname-based Access application
instead? Run `.\setup.ps1 -TeamDomain https://your-team.cloudflareaccess.com -Aud <tag>`.)

## 5. Finish the config and add provider keys

```powershell
.\setup.ps1 -AllowedEmails you@example.com
npx wrangler deploy
npx wrangler secret put TELNYX_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
```

Skip any provider you don't use; the page shows it as "no API key set".
`-AllowedEmails` is optional: the Worker then also checks the signed-in email.

## 6. Check it

- [ ] Your hostname in a private window asks for an email code.
- [ ] `https://<hostname>/api/config` without signing in returns 403.
- [ ] A lookup with paid services unticked shows region, FCC reports and links.
- [ ] A lookup with paid services on shows a name/carrier and a cost.
- [ ] The same number again shows `cached · $0`.
- [ ] In **Paid services and budget**, a cap of 0 blocks paid lookups with a
      message; switching a provider takes effect on the next lookup.

## 7. Launchers

**iPhone Shortcut** (Shortcuts app > +):

1. **Get Clipboard**
2. **Replace Text**: find `\D`, replace with nothing, Regular Expression on.
3. **Replace Text**: find `^1(\d{10})$`, replace with `$1`, Regular Expression on.
4. **URL**: `https://ringcheck.example.com/?n=` followed by the *Updated Text*
   variable.
5. **Open URLs**

Name it RingCheck. Copy a number in Recents, then run it from the Home Screen,
Back Tap or the Action button.

**Windows hotkey:**

```powershell
.\desktop\install-hotkey.ps1 -Url https://ringcheck.example.com
```

Copy a number anywhere and press **Ctrl+Alt+R**. Remove it with
`.\desktop\install-hotkey.ps1 -Remove`.

**Browser keyword** (Edge or Chrome > Settings > Search engines > Site search >
Add): keyword `rc`, URL `https://ringcheck.example.com/?n=%s`. Then type
`rc 2025550187` in the address bar.

**App window:** open the page in Edge or Chrome and choose *Install RingCheck*
from the browser menu, then pin it to the taskbar. Pasting a number into the
page runs the lookup.

## Settings, prices and cap

The **Paid services and budget** panel on the page turns each service on or
off, picks Telnyx or Twilio per service, and sets the monthly cap. Prices and
cache lengths can be changed by editing `config.example.json` and running:

```powershell
npx wrangler kv key put config --path config.example.json --binding RINGCHECK_KV --remote
```

## Local development

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run dev
npm test
```

`DEV_BYPASS_ACCESS=true` skips the Access check only for `localhost`.

## Linux

```bash
git clone https://github.com/<you>/ringcheck.git
cd ringcheck
npm ci
npx wrangler login
```

PowerShell 7 for `setup.ps1` (no root needed):

```bash
ver=$(curl -sS https://api.github.com/repos/PowerShell/PowerShell/releases/latest | python3 -c "import sys,json;print(json.load(sys.stdin)['tag_name'].lstrip('v'))")
curl -sSL -o /tmp/pwsh.tgz "https://github.com/PowerShell/PowerShell/releases/download/v$ver/powershell-$ver-linux-x64.tar.gz"
mkdir -p ~/.local/pwsh
tar -xzf /tmp/pwsh.tgz -C ~/.local/pwsh
chmod +x ~/.local/pwsh/pwsh
rm /tmp/pwsh.tgz
~/.local/pwsh/pwsh -NoProfile -File ./setup.ps1 -Hostname ringcheck.example.com -CreateKv
```

Without PowerShell: `cp wrangler.example.toml wrangler.toml` and fill in the
`__PLACEHOLDER__` values.

Deploy, Access and secrets are the same as steps 3 to 5:

```bash
npx wrangler deploy
~/.local/pwsh/pwsh -NoProfile -File ./setup.ps1 -AllowedEmails you@example.com
npx wrangler deploy
npx wrangler secret put TELNYX_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
```

Local dev and checks:

```bash
cp .dev.vars.example .dev.vars
npx wrangler dev --persist-to ~/.ringcheck-state   # keep local KV off mounted/network drives
npm test
npx wrangler deploy --dry-run --outdir /tmp/ringcheck-dist
```

Regenerate the area code table:

```bash
pip install phonenumbers
python3 scripts/gen-npa.py
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Page says "the sign-in check failed" | Access isn't protecting the Worker (Access tab, **All traffic**), your email isn't in `ALLOWED_EMAILS`, or, with a hostname-based Access app, `TEAM_DOMAIN`/`POLICY_AUD` don't match it. |
| "No API key set" | Add the provider's secrets with `npx wrangler secret put`. |
| "The provider rejected the API key" | The key or token is wrong or revoked; put it again. |
| Custom domain fails to deploy | The domain must be on Cloudflare DNS, and the hostname can't already have a DNS record. |
| Hotkey does nothing | Run `desktop\install-hotkey.ps1` again; shortcut keys only work for shortcuts in the Start Menu or on the desktop. |
