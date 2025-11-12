import fetch from "node-fetch";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FB_APP_ID = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";

const FB_URL_RE = /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:profile\.php\?id=(?<id>\d+)|(?<username>[^/?&#]+))/i;

function extractFbIdOrUsername(url) {
  const m = FB_URL_RE.exec(url.trim());
  if (!m) return [null, null];
  return [m.groups?.id, m.groups?.username];
}

function getFbAppToken() {
  if (FB_APP_ID && FB_APP_SECRET) {
    return `${FB_APP_ID}|${FB_APP_SECRET}`;
  }
  return null;
}

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

    return {
      success: true,
      name: data.name || "Unknown",
      username: data.username,
      id: data.id,
      imageUrl: imgUrl,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

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

    return {
      success: true,
      name,
      username: isId ? null : identifier,
      id: isId ? identifier : null,
      imageUrl: imgUrl,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==============================
// 🤖 Telegram Handler
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

    // /start command
    if (text.startsWith("/start")) {
      const msg = `
👋 হ্যালো! আমি <b>Facebook Info Bot</b> 🤖  
আমাকে ফেসবুক প্রোফাইল লিংক দিন — আমি নাম, ইউজারনেম/আইডি ও প্রোফাইল ছবি দেখাবো।

🧭 উদাহরণ:
https://facebook.com/zuck  
https://facebook.com/profile.php?id=123456789  

🔹 সাহায্যের জন্য /help লিখুন।
`;
      await sendMessage(chatId, msg, { parse_mode: "HTML" });
      return res.status(200).send("ok");
    }

    // /help command
    if (text.startsWith("/help")) {
      const msg = `
📘 সাহায্য কেন্দ্র:

🪪 ফেসবুক প্রোফাইল তথ্য দেখতে শুধু প্রোফাইল লিংক পাঠান।  
যেমন:
https://facebook.com/zuck  
অথবা  
https://facebook.com/profile.php?id=123456789  

⚙️ কমান্ড তালিকা:
• /start — বট চালু করুন  
• /help — সাহায্য দেখুন  
• /about — বট সম্পর্কে জানুন
`;
      await sendMessage(chatId, msg);
      return res.status(200).send("ok");
    }

    // /about command
    if (text.startsWith("/about")) {
      const aboutMsg = `
🤖 <b>Facebook Info Bot</b>  
🌐 <i>বটের কাজ:</i> ফেসবুক প্রোফাইল লিংক থেকে নাম, ইউজারনেম বা আইডি এবং প্রোফাইল ছবি দেখানো।

👨‍💻 <b>ডেভেলপার:</b> Rana Ahmed  
💬 GitHub: <a href="https://github.com/ranaahmeddev">ranaahmeddev</a>  
🌎 Website: <a href="https://ranaahmed.vercel.app">ranaahmed.vercel.app</a>  
🗓️ Deployed on: 12 Nov 2025

📢 Node.js (Vercel Serverless) এবং Telegram Bot API দিয়ে তৈরি।
`;
      await sendMessage(chatId, aboutMsg, { parse_mode: "HTML" });
      return res.status(200).send("ok");
    }

    // Facebook profile section
    const [fbId, username] = extractFbIdOrUsername(text);
    if (!fbId && !username) {
      await sendMessage(chatId, "❌ দয়া করে একটি সঠিক Facebook প্রোফাইল লিংক দিন।");
      return res.status(200).send("Invalid link");
    }

    const identifier = username || fbId;
    const profileUrl = `https://facebook.com/${identifier}`;
    await sendMessage(chatId, "🔎 প্রোফাইল তথ্য খোঁজা হচ্ছে...");

    let result = await fetchProfileDataGraph(identifier);
    if (!result.success) {
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
    console.error("❌ Error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

// ==============================
// 📨 Telegram API Helpers
// ==============================
async function sendMessage(chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...extra,
    }),
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
