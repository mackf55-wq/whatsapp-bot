const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mybot123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const SHEET_ID = "1mJsL0AnvdEp1Td0pTT1TWtlvknPweZx3V9QhCcG0RVg";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

// ─── DROPBOX TOKEN MANAGER ──────────────────────────────────────────────────
let dropboxAccessToken = null;
let tokenExpiresAt = 0;

async function getDropboxToken() {
  // Return cached token if still valid (with 5 min buffer)
  if (dropboxAccessToken && Date.now() < tokenExpiresAt - 300000) {
    return dropboxAccessToken;
  }

  try {
    const response = await axios.post(
      "https://api.dropbox.com/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    dropboxAccessToken = response.data.access_token;
    tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
    console.log("✅ Dropbox token refreshed successfully");
    return dropboxAccessToken;
  } catch (err) {
    console.error("❌ Failed to refresh Dropbox token:", err.response?.data || err.message);
    return null;
  }
}

// ─── CONVERSATION STATE ─────────────────────────────────────────────────────
const sessions = {};

// ─── FETCH SHEET DATA ───────────────────────────────────────────────────────
async function fetchSheetData() {
  const res = await axios.get(SHEET_URL);
  const rows = res.data.trim().split("\n").slice(1);
  return rows.map((row) => {
    const cols = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') { inQuotes = !inQuotes; }
      else if (row[i] === "," && !inQuotes) { cols.push(current.trim()); current = ""; }
      else { current += row[i]; }
    }
    cols.push(current.trim());
    return {
      searchKey: cols[0]?.toLowerCase() || "",
      address: cols[1] || "",
      boro: cols[2] || "",
      doorCode: cols[3] || "",
      customerName: cols[4] || "",
      customerContact: cols[5] || "",
      cleaningGuy: cols[6] || "",
      cleaningDays: cols[7] || "",
      garbageGuy: cols[8] || "",
      garbageDays: cols[9] || "",
      recyclingDays: cols[10] || "",
      pullbackDays: cols[11] || "",
      monthlyPrice: cols[12] || "",
      unitCount: cols[13] || "",
      inspector: cols[14] || "",
      inspectionDate: cols[15] || "",
      managerName: cols[16] || "",
      managerPhone: cols[17] || "",
      managerEmail: cols[18] || "",
      notes: cols[19] || "",
    };
  });
}

// ─── LOOKUP ADDRESS ─────────────────────────────────────────────────────────
async function lookupAddress(query) {
  const data = await fetchSheetData();
  const q = query.toLowerCase().trim();
  return data.find(
    (row) => row.searchKey.includes(q) || row.address.toLowerCase().includes(q) || q.includes(row.searchKey)
  ) || null;
}

// ─── FORMAT REPLY ───────────────────────────────────────────────────────────
function formatReply(p) {
  return (
    `📍 *${p.address}, ${p.boro}*\n` +
    `🔑 Door Code: ${p.doorCode}\n` +
    `👤 Customer: ${p.customerName}\n` +
    `📞 Contact: ${p.customerContact}\n\n` +
    `🧹 *Cleaning*\n   Worker: ${p.cleaningGuy}\n   Days: ${p.cleaningDays}\n\n` +
    `🗑️ *Garbage*\n   Worker: ${p.garbageGuy}\n   Days: ${p.garbageDays}\n\n` +
    `♻️ Recycling: ${p.recyclingDays}\n` +
    `↩️ Pullback: ${p.pullbackDays}\n\n` +
    `🏢 Units: ${p.unitCount} | 💰 $${p.monthlyPrice}/mo\n` +
    `🔍 Inspector: ${p.inspector} (${p.inspectionDate})\n\n` +
    `👔 *Manager*\n   ${p.managerName}\n   📞 ${p.managerPhone}\n   📧 ${p.managerEmail}\n\n` +
    `📝 Notes: ${p.notes}`
  );
}

// ─── DROPBOX SEARCH ─────────────────────────────────────────────────────────
async function searchDropbox(address, month, day) {
  const months = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04",
    jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };

  const monthNum = months[month.toLowerCase()];
  if (!monthNum) return null;

  const dayPadded = day.toString().padStart(2, "0");
  const datePattern = `${monthNum}-${dayPadded}`;

  const token = await getDropboxToken();
  if (!token) return null;

  const searchRes = await axios.post(
    "https://api.dropboxapi.com/2/files/search_v2",
    {
      query: address,
      options: {
        path: "/Photos",
        file_extensions: ["zip", "jpg", "jpeg", "png"],
        max_results: 100
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  const matches = searchRes.data.matches || [];

  const filtered = matches.filter(m => {
    const name = m.metadata?.metadata?.name || "";
    return name.toLowerCase().includes(address.toLowerCase()) && name.includes(datePattern);
  });

  return filtered.map(m => m.metadata?.metadata);
}

// ─── GET DROPBOX SHARE LINK ─────────────────────────────────────────────────
async function getDropboxLink(path) {
  const token = await getDropboxToken();
  if (!token) return null;

  try {
    const res = await axios.post(
      "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
      { path, settings: { requested_visibility: "public" } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
    return res.data.url.replace("?dl=0", "?dl=1");
  } catch (err) {
    if (err.response?.data?.error?.[".tag"] === "shared_link_already_exists") {
      const existing = err.response.data.error.shared_link_already_exists?.metadata?.url;
      if (existing) return existing.replace("?dl=0", "?dl=1");
    }
    return null;
  }
}

// ─── SEND WHATSAPP MESSAGE ──────────────────────────────────────────────────
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: "whatsapp", to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
  );
}

// ─── HANDLE PHOTO FLOW ──────────────────────────────────────────────────────
async function handlePhotoFlow(from, text, session) {
  if (!session.month) {
    session.month = text;
    sessions[from] = session;
    await sendMessage(from, `📅 Which day? (just the number, e.g. 30)`);
    return;
  }

  if (!session.day) {
    session.day = text;
    await sendMessage(from, `🔍 Searching photos for *${session.address}* on ${session.month} ${session.day}...`);

    try {
      const files = await searchDropbox(session.address, session.month, session.day);

      if (!files || files.length === 0) {
        await sendMessage(from, `❌ No photos found for *${session.address}* on ${session.month} ${session.day}.\n\nTry a different date or check the address spelling.`);
      } else {
        await sendMessage(from, `📸 Found ${files.length} file(s) for *${session.address}* on ${session.month} ${session.day}:`);

        for (const file of files.slice(0, 10)) {
          const link = await getDropboxLink(file.path_lower);
          if (link) {
            await sendMessage(from, `📦 ${file.name}\n${link}`);
          }
        }

        if (files.length > 10) {
          await sendMessage(from, `... and ${files.length - 10} more files. Please check Dropbox for the rest.`);
        }
      }
    } catch (err) {
      console.error("Dropbox error:", err.message);
      await sendMessage(from, `❌ Error searching Dropbox. Please try again.`);
    }

    delete sessions[from];
    return;
  }
}

// ─── WEBHOOK VERIFICATION ───────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── WEBHOOK MESSAGE HANDLER ────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const from = message.from;
    const text = message.text.body.trim();
    console.log(`Message from ${from}: ${text}`);

    if (sessions[from]) {
      await handlePhotoFlow(from, text, sessions[from]);
      return;
    }

    if (text.toLowerCase().startsWith("photos ")) {
      const address = text.slice(7).trim();
      const result = await lookupAddress(address);

      if (!result) {
        await sendMessage(from, `❌ No address found for "*${address}*"\n\nTry: _photos 1530 park_`);
        return;
      }

      sessions[from] = { address: result.address, month: null, day: null };
      await sendMessage(from, `📸 Photos for *${result.address}*\n\nWhich month? (e.g. January or Jan)`);
      return;
    }

    const result = await lookupAddress(text);
    if (result) {
      await sendMessage(from, formatReply(result));
    } else {
      await sendMessage(from,
        `❌ No address found for "*${text}*"\n\n` +
        `Try:\n• _1530 park_ — for address info\n• _photos 1530 park_ — for photos`
      );
    }
  } catch (err) {
    console.error("Error handling message:", err.message);
  }
});

// ─── START SERVER ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Bot running on port ${PORT}`);
  // Pre-warm the Dropbox token on startup
  await getDropboxToken();
});

