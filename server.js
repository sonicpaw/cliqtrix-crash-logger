// ==============================================
// server.js - Full working backend for Cliqtrix
// Author: You
// ==============================================

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// -----------------------------------------------
// 1) Initialize Firebase Admin
// -----------------------------------------------
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log("Firebase Admin initialized successfully.");
} catch (e) {
  console.error("Firebase Admin init error:", e);
}

const db = admin.firestore();

// -----------------------------------------------
// 2) TEST ENDPOINT
// -----------------------------------------------
app.post("/test", async (req, res) => {
  console.log("🔥 Received /test call from Zoho Cliq:", req.body);

  return res.json({
    ok: true,
    msg: "Backend reached successfully!",
    received: req.body
  });
});

// -----------------------------------------------
// 3) LINK ACCOUNT ENDPOINT
// -----------------------------------------------
app.post("/link-account", async (req, res) => {
  try {
    const { cliq_user, github_login } = req.body;

    if (!cliq_user || !github_login) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Save mapping
    await db.collection("cliq_mapping").doc(cliq_user).set({
      github_login,
      updated: Date.now()
    });

    console.log("Mapped user:", cliq_user, "->", github_login);

    // --- Notify Cliq Bot via webhook ---
    try {
      const webhookUrl = process.env.CLIQ_INCOMING_WEBHOOK;

      if (webhookUrl) {
        const payload = {
          text: `✅ *Mapping Created*\n\n**Cliq User:** ${cliq_user}\n**GitHub:** ${github_login}`
          user_id: "907431528"
        };

        await axios.post(webhookUrl, payload, {
          headers: { "Content-Type": "application/json" }
        });

        console.log("Sent Cliq bot webhook notification.");
      } else {
        console.log("CLIQ_INCOMING_WEBHOOK not set.");
      }
    } catch (hookErr) {
      console.error("Webhook error:", hookErr?.response?.data || hookErr.message);
    }

    return res.json({
      ok: true,
      message: "Mapping saved successfully",
      cliq_user,
      github_login
    });

  } catch (err) {
    console.error("link-account error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------
// 4) ERROR REPORT ENDPOINT (Crash Reporter)
// -----------------------------------------------
app.post("/error-report", async (req, res) => {
  try {
    const crash = req.body;

    if (!crash.message) {
      return res.status(400).json({ ok: false, error: "missing_error_message" });
    }

    // Save crash report
    const docRef = await db.collection("crash_reports").add({
      ...crash,
      received: Date.now()
    });

    console.log("Crash saved:", docRef.id);

    // --- Notify Cliq Bot via webhook ---
    try {
      const webhookUrl = process.env.CLIQ_INCOMING_WEBHOOK;

      if (webhookUrl) {
        const payload = {
          text:
            `❗ *New Error Reported*\n\n` +
            `**Message:** ${crash.message}\n` +
            `**URL:** ${crash.url || "N/A"}\n` +
            `**User Agent:** ${crash.userAgent || "N/A"}\n` +
            `**ID:** ${docRef.id}`
        };

        await axios.post(webhookUrl, payload, {
          headers: { "Content-Type": "application/json" }
        });

        console.log("Sent crash webhook notification.");
      }
    } catch (e) {
      console.error("Webhook error:", e?.response?.data || e.message);
    }

    return res.json({ ok: true, crash_id: docRef.id });

  } catch (err) {
    console.error("error-report endpoint error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// -----------------------------------------------
// 5) START SERVER
// -----------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

