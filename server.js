require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cookieParser());

const {
  BASE_URL,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_SCOPES
} = process.env;

if (!BASE_URL || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn('One or more required env vars missing (BASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET).');
}

// Utility: generate random state
function genState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * STEP: Start OAuth flow
 * GET /install
 * Redirects user to GitHub authorize page
 */
app.get('/install', (req, res) => {
  const state = genState();
  // set state cookie (httpOnly, secure recommended)
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 10*60*1000 });
  const scopes = GITHUB_SCOPES || 'repo read:user';
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_URL}/oauth/callback`,
    scope: scopes,
    state
  });
  const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  return res.redirect(authUrl);
});

/**
 * STEP: OAuth callback
 * GET /oauth/callback?code=...&state=...
 * Exchanges code for token and fetches GitHub user
 */
app.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  const cookieState = req.cookies.oauth_state;

  if (!code || !state || !cookieState || state !== cookieState) {
    return res.status(400).send('<h3>OAuth validation failed (missing or invalid state).</h3>');
  }

  try {
    // Exchange code for access token
    const tokenResp = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${BASE_URL}/oauth/callback`,
      state
    }, {
      headers: { Accept: 'application/json' }
    });

    const tokenData = tokenResp.data;
    if (!tokenData || !tokenData.access_token) {
      console.error('No access_token in response:', tokenData);
      return res.status(500).send('<h3>OAuth token exchange failed.</h3>');
    }
    const accessToken = tokenData.access_token;

    // Fetch the GitHub user to map the token
    const userResp = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' }
    });

    const ghUser = userResp.data;

    // TEMP: store mapping in-memory or log — we'll persist to DB in Step 3
    // WARNING: In production store tokens securely (encrypted DB)
    console.log('=== New GitHub install ===');
    console.log('github_user_id:', ghUser.id);
    console.log('github_login :', ghUser.login);
    console.log('access_token  :', accessToken);
    console.log('scopes        :', tokenData.scope || GITHUB_SCOPES);

    // Respond with friendly success page that instructs user to return to Cliq
    res.clearCookie('oauth_state');
    return res.send(`
      <html>
        <head><meta charset="utf-8"><title>Installation successful</title></head>
        <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Helvetica Neue',Arial">
          <h2>Installation successful ✅</h2>
          <p>Your GitHub account <strong>${ghUser.login}</strong> is connected.</p>
          <p>You can now close this window and return to Zoho Cliq.</p>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('OAuth callback error', err.response?.data || err.message);
    return res.status(500).send('<h3>OAuth callback error — check server logs.</h3>');
  }
});

/**
 * Minimal error-report endpoint placeholder
 * POST /error-report
 * (We will secure and extend this later)
 */
app.post('/error-report', async (req, res) => {
  // Expect JSON payload with fields like { message, stack, url, userAgent, ts }
  console.log('Received error-report:', req.body);
  // TODO: persist to Firestore/DB and create GitHub issue (Step 4)
  return res.status(201).json({ ok: true });
});

/**
 * Health check
 */
app.get('/health', (req, res) => res.send({ ok: true, ts: Date.now() }));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`BASE_URL = ${BASE_URL}`);
});
