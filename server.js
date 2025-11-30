// ==============================================
// FULL server.js — Working Zoho Cliq Webhook DM
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
// 3) LINK ACCOUNT ENDPOINT (DM Notification)
// -----------------------------------------------
app.post("/link-account", async (req, res) => {
  try {
    const { cliq_user, github_login } = req.body;

    if (!cliq_user || !github_login) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Save mapping to Firestore
    await db.collection("cliq_mapping").doc(cliq_user).set({
      github_login: github_login,
      updated: Date.now()
    });

    console.log("Mapped user:", cliq_user, "->", github_login);

    // ---- Send DM to your Zoho account ----
    try {
      const webhookUrl = process.env.CLIQ_INCOMING_WEBHOOK;

      if (webhookUrl) {
        const payload = {
          text: `✅ Mapping Created\n\n**Cliq User:** ${cliq_user}\n**GitHub:** ${github_login}`,
          user_id: "907444797"       // <--- YOUR USER ID
        };

        const resp = await axios.post(webhookUrl, payload, {
          headers: { "Content-Type": "application/json" }
        });

        console.log("Webhook Sent:", resp.data);
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

    const docRef = await db.collection("crash_reports").add({
      ...crash,
      received: Date.now()
    });

    console.log("Crash saved:", docRef.id);

    // ---- Send crash to your DM as well ----
    try {
      const webhookUrl = process.env.CLIQ_INCOMING_WEBHOOK;

      if (webhookUrl) {
        const payload = {
          text:
            `❗ **New Crash Reported**\n\n` +
            `**Message:** ${crash.message}\n` +
            `**URL:** ${crash.url || "N/A"}\n` +
            `**User Agent:** ${crash.userAgent || "N/A"}\n` +
            `**Crash ID:** ${docRef.id}`,
          user_id: "907444797"     // <--- YOUR USER ID
        };

        const resp = await axios.post(webhookUrl, payload, {
          headers: { "Content-Type": "application/json" }
        });

        console.log("Crash Webhook Sent:", resp.data);
      }

    } catch (hookErr) {
      console.error("Webhook error:", hookErr?.response?.data || hookErr.message);
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

