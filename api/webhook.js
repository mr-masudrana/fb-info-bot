import fetch from "node-fetch";
import * as cheerio from "cheerio";

// ==============================
// 🔧 Environment Variables
// ==============================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FB_APP_ID = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";

const FB_URL_RE = /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:profile\.php\?id=(?<id>\d+)|(?<username>[^/?&#]+))/i;

// ==============================
// 🔍 Extract ID or Username
// ==============================
function extractFbIdOrUsername(url) {
  const m = FB_URL_RE.exec(url.trim());
  if (!m) return [null, null];
  return [m.groups?.id, m.groups?.username];
}

// ==============================
// 🔐 Facebook App Token
// ==============================
function getFbAppToken() {
  if (FB_APP_ID && FB_APP_SECRET) {
    return `${FB_APP_ID}|${FB_APP_SECRET}`;
  }
  return null;
}

// ==============================
// 🧠 Fetch Profile via Graph API
// ==============================
async function fetchProfileDataGraph(identifier) {
  const appToken = getFbAppToken();
  const params = new URLSearchParams({
    fields: "name,username,id,picture.type(large)",
  });
  if (appToken) params.append("access_token", appToken);

  const url = `https://graph.facebook.com/${identifier}?${params.toString()}`;
  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    const imgUrl = data.picture?.data?.url;
    if (!imgUrl) {
      return { success: false, error: "No profile picture found" };
    }

    const imgRes = await fetch(imgUrl);
    const imgBuffer = await imgRes.arrayBuffer();

    return {
      success: true,
      name: data.name || "Unknown",
      username: data.username,
      id: data.id,
      imageBytes: Buffer.from(imgBuffer),
      imageUrl: imgUrl,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==============================
// 🌐 HTML Fallback (og:image, og:title)
// ==============================
async function fetchProfileDataHtml(profileUrl, identifier, isId) {
  try {
    const res = await fetch(profileUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const imgUrl = $('meta[property="og:image"]').attr("content");
    const name = $('meta[property="og:title"]').attr("content") || "Unknown Name";

    if (!imgUrl) {
      return { success: false, error: "No og:image found" };
    }

    const imgRes = await fetch(imgUrl);
    const imgBuffer = await imgRes.arrayBuffer();

    return {
      success: true,
      name,
      username: isId ? null : identifier,
      id: isId ? identifier : null,
      imageBytes: Buffer.from(imgBuffer),
      imageUrl: imgUrl,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==============================
// 🤖 Telegram Webhook Handler
// ==============================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("✅ Telegram Bot is Running!");
  }

  try {
    const update = req.body;
    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text?.trim();

    if (!text) {
      return res.status(200).send("No text found");
    }

    // extract fb id or username
    const [fbId, username] = extractFbIdOrUsername(text);
    if (!fbId && !username) {
      await sendMessage(chatId, "❌ দয়া করে একটি সঠিক Facebook প্রোফাইল লিংক দিন।");
      return res.status(200).send("Invalid link");
    }

    const identifier = username || fbId;
    const profileUrl = `https://facebook.com/${identifier}`;
    await sendMessage(chatId, "🔎 প্রোফাইল তথ্য খোঁজা হচ্ছে...");

    // 1️⃣ Try Graph API
    let result = await fetchProfileDataGraph(identifier);
    if (!result.success) {
      // 2️⃣ Try HTML fallback
      result = await fetchProfileDataHtml(profileUrl, identifier, Boolean(fbId));
    }

    if (!result.success) {
      await sendMessage(chatId, "😔 তথ্য আনা যায়নি। কারণ: " + result.error);
      return res.status(200).send("Failed");
    }

    const caption = [
      `🧑‍💼 নাম: ${result.name}`,
      result.username ? `🔖 Username: ${result.username}` : result.id ? `🆔 ID: ${result.id}` : "",
    ].join("\n");

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🔗 View Full Picture", url: result.imageUrl },
          { text: "🌐 Go to Facebook", url: profileUrl },
        ],
      ],
    };

    await sendPhoto(chatId, result.imageUrl, caption, keyboard);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

// ==============================
// 📨 Telegram API Helpers
// ==============================
async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendPhoto(chatId, photoUrl, caption, replyMarkup) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      reply_markup: replyMarkup,
    }),
  });
}
