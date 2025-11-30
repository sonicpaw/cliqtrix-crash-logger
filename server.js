require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cookieParser());

const {
  BASE_URL,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_SCOPES,
  FIREBASE_SERVICE_ACCOUNT,
  DEMO_GH_REPO
} = process.env;

// ---------------- FIREBASE INITIALIZATION ----------------
if (!admin.apps.length) {
  if (!FIREBASE_SERVICE_ACCOUNT) {
    console.warn("FIREBASE_SERVICE_ACCOUNT missing. Firestore won't work.");
  } else {
    try {
      const parsedServiceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(parsedServiceAccount)
      });
      console.log("Firebase Admin initialized successfully.");
    } catch (e) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", e.message);
    }
  }
}

const db = admin.apps.length ? admin.firestore() : null;

// Utility: generate random state
function genState() {
  return crypto.randomBytes(16).toString("hex");
}

// ---------------- GITHUB OAUTH REDIRECT ----------------
app.get("/install", (req, res) => {
  const state = genState();

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 10 * 60 * 1000
  });

  const scopes = GITHUB_SCOPES || "repo read:user";

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_URL}/oauth/callback`,
    scope: scopes,
    state
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  res.redirect(authUrl);
});

// ---------------- GITHUB CALLBACK ----------------
app.get("/oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  const cookieState = req.cookies.oauth_state;

  if (!code || !state || state !== cookieState) {
    return res.status(400).send("<h3>OAuth failed: Invalid state.</h3>");
  }

  try {
    const tokenResp = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${BASE_URL}/oauth/callback`,
        state
      },
      { headers: { Accept: "application/json" } }
    );

    const tokenData = tokenResp.data;
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(500).send("<h3>OAuth token exchange failed.</h3>");
    }

    const userResp = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json"
      }
    });

    const ghUser = userResp.data;

    // SAVE TOKEN IN FIRESTORE
    if (db) {
      await db.collection("oauth_tokens").doc(String(ghUser.id)).set({
        github_id: ghUser.id,
        login: ghUser.login,
        access_token: accessToken,
        scope: tokenData.scope,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Token stored for ${ghUser.login}`);
    }

    res.clearCookie("oauth_state");
    return res.send(`
      <h2>Installation successful ✅</h2>
      <p>Your GitHub account <strong>${ghUser.login}</strong> is connected.</p>
      <p>You can close this window.</p>
    `);

  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).send("<h3>OAuth callback failed.</h3>");
  }
});

// ---------------- CRASH REPORT ENDPOINT ----------------
app.post("/error-report", async (req, res) => {
  const payload = req.body || {};
  payload.receivedAt = new Date().toISOString();

  try {
    let crashRef = null;

    // 1 — Save crash to Firestore
    if (db) {
      crashRef = await db.collection("crash_reports").add(payload);
      console.log("Crash saved:", crashRef.id);
    }

    // 2 — Create GitHub issue
    if (!DEMO_GH_REPO) {
      return res.status(201).json({ ok: true, note: "Repo not configured" });
    }

    // Get any stored token
    const snap = await db.collection("oauth_tokens").limit(1).get();
    if (snap.empty) {
      return res.status(201).json({ ok: true, note: "No tokens saved" });
    }

    const token = snap.docs[0].data().access_token;

    const [owner, repo] = DEMO_GH_REPO.split("/");
    const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues`;

    const title = `Crash: ${payload.message || "Unknown error"}`;

    const body = `
**Crash Report**

**Message:**
\`\`\`
${payload.message}
\`\`\`

**Stack:**
\`\`\`
${payload.stack}
\`\`\`

**URL:** ${payload.url}
**Agent:** ${payload.userAgent}
**Received:** ${payload.receivedAt}
`.trim();

    const issueResp = await axios.post(
      issueUrl,
      { title, body },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    const issueLink = issueResp.data.html_url;

    if (db && crashRef) {
      await crashRef.update({ github_issue: issueLink });
    }

    return res.status(201).json({ ok: true, issue: issueLink });

  } catch (err) {
    console.error("error-report error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------- HEALTH CHECK ----------------
app.get("/health", (req, res) => {
  res.send({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on ${PORT}`)
);
