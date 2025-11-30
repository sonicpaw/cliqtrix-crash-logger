// ---------------------------------------------
// SERVER.JS — FULL WORKING VERSION
// ---------------------------------------------

const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// ---------------------------------------------
// FIREBASE INIT
// ---------------------------------------------
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("Firebase Admin initialized successfully.");
} catch (err) {
  console.error("Firebase init error:", err);
}

// Firestore ref
const db = admin.firestore();

// ---------------------------------------------
// ROOT ENDPOINT
// ---------------------------------------------
app.get("/", (req, res) => {
  res.send("DevOps Crashlytics Backend Running");
});

// ---------------------------------------------
// /link-account — maps cliq_user <-> github_login
// ---------------------------------------------
app.post("/link-account", async (req, res) => {
  try {
    const { cliq_user, github_login } = req.body;

    if (!cliq_user || !github_login) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    await db.collection("cliq_mapping").doc(cliq_user).set({
      github_login: github_login,
      updated: Date.now()
    });

    console.log("Mapped user:", cliq_user, "->", github_login);

    return res.json({
      ok: true,
      message: "Mapping saved!",
      user: cliq_user,
      github: github_login
    });
  } catch (err) {
    console.error("link-account error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------
// /error-report — save crashes + create GH issue
// ---------------------------------------------
app.post("/error-report", async (req, res) => {
  try {
    const crash = req.body;
    crash.ts_saved = Date.now();

    const docRef = await db.collection("crash_reports").add(crash);

    console.log("Crash saved:", docRef.id);

    return res.json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error("error-report:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------
// /test — for Cliq external API test
// ---------------------------------------------
app.post("/test", (req, res) => {
  console.log("🔥 Received /test call from Zoho Cliq:", req.body);

  res.json({
    ok: true,
    msg: "Backend reached successfully!",
    received: req.body || null,
    timestamp: Date.now()
  });
});

// ---------------------------------------------
// START SERVER
// ---------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
