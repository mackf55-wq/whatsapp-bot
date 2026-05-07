const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mybot123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SHEET_ID = "1mJsL0AnvdEp1Td0pTT1TWtlvknPweZx3V9QhCcG0RVg";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

// ─── FETCH SHEET DATA ───────────────────────────────────────────────────────
async function fetchSheetData() {
  const res = await axios.get(SHEET_URL);
  const rows = res.data.trim().split("\n").slice(1); // skip header row
  return rows.map((row) => {
    // Parse CSV properly handling quoted fields
    const cols = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') {
        inQuotes = !inQuotes;
      } else if (row[i] === "," && !inQuotes) {
        cols.push(current.trim());
        current = "";
      } else {
        current += row[i];
      }
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
  // Try to match search key or partial address
  const match = data.find(
    (row) =>
      row.searchKey.includes(q) ||
      row.address.toLowerCase().includes(q) ||
      q.includes(row.searchKey)
  );
  return match || null;
}

// ─── FORMAT REPLY ───────────────────────────────────────────────────────────
function formatReply(p) {
  return (
    `📍 *${p.address}, ${p.boro}*\n` +
    `🔑 Door Code: ${p.doorCode}\n` +
    `👤 Customer: ${p.customerName}\n` +
    `📞 Contact: ${p.customerContact}\n\n` +
    `🧹 *Cleaning*\n` +
    `   Worker: ${p.cleaningGuy}\n` +
    `   Days: ${p.cleaningDays}\n\n` +
    `🗑️ *Garbage*\n` +
    `   Worker: ${p.garbageGuy}\n` +
    `   Days: ${p.garbageDays}\n\n` +
    `♻️ Recycling: ${p.recyclingDays}\n` +
    `↩️ Pullback: ${p.pullbackDays}\n\n` +
    `🏢 Units: ${p.unitCount} | 💰 $${p.monthlyPrice}/mo\n` +
    `🔍 Inspector: ${p.inspector} (${p.inspectionDate})\n\n` +
    `👔 *Manager*\n` +
    `   ${p.managerName}\n` +
    `   📞 ${p.managerPhone}\n` +
    `   📧 ${p.managerEmail}\n\n` +
    `📝 Notes: ${p.notes}`
  );
}

// ─── SEND WHATSAPP MESSAGE ──────────────────────────────────────────────────
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
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
  res.sendStatus(200); // Always respond fast to Meta

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message || message.type !== "text") return;

    const from = message.from;
    const text = message.text.body.trim();

    console.log(`Message from ${from}: ${text}`);

    const result = await lookupAddress(text);

    if (result) {
      await sendMessage(from, formatReply(result));
    } else {
      await sendMessage(
        from,
        `❌ No address found for "*${text}*"\n\nTry typing part of the address, e.g:\n• _1530 park_\n• _268 fountain_\n• _855 morris_`
      );
    }
  } catch (err) {
    console.error("Error handling message:", err.message);
  }
});

// ─── START SERVER ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
