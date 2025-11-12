import fetch from "node-fetch";
import * as cheerio from "cheerio";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const FB_APP_ID = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const ADMIN_ID = process.env.ADMIN_ID; // ✅ অ্যাডমিন আইডি .env থেকে

// Simple in-memory user list (temporary for Vercel)
let users = [];

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

// ==============================
// 🧠 Fetch profile info
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
    if (data.error) return { success: false, error: data.error.message };

    const imgUrl = data.picture?.data?.url;
    if (!imgUrl) return { success: false, error: "No profile picture found" };

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
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };

    const html = await res.text();
    const $ = cheerio.load(html);
    const imgUrl = $('meta[property="og:image"]').attr("content");
    const name = $('meta[property="og:title"]').attr("content") || "Unknown Name";

    if (!imgUrl) return { success: false, error: "No og:image found" };

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
    const user = message.from;

    if (!text) return res.status(200).send("No text");

    // ==============================
    // 🧩 /start কমান্ড
    // ==============================
    if (text.startsWith("/start")) {
      // নতুন ইউজার সংরক্ষণ করো
      if (!users.find(u => u.id === user.id)) {
        users.push({
          id: user.id,
          name: user.first_name,
          username: user.username || null,
        });
      }

      // অ্যাডমিনকে নোটিফাই করো
      if (ADMIN_ID) {
        await sendMessage(
          ADMIN_ID,
          `📢 নতুন ইউজার বট চালু করেছে!\n👤 নাম: ${user.first_name}\n🆔 ID: ${user.id}\n💬 Username: @${user.username || "N/A"}`
        );
      }

      const welcomeText = `
👋 হ্যালো ${user.first_name || "বন্ধু"}!
আমি Facebook Info Bot 🤖  
আমাকে ফেসবুক প্রোফাইল লিংক দিন — আমি নাম, ইউজারনেম/আইডি ও প্রোফাইল ছবি দেখাবো।

🧭 উদাহরণ:
https://facebook.com/zuck  
https://facebook.com/profile.php?id=123456789  

🔹 সাহায্যের জন্য /help লিখুন।
      `;
      await sendMessage(chatId, welcomeText);
      return res.status(200).send("ok");
    }

    // ==============================
    // 🧩 /help কমান্ড
    // ==============================
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
• /users — (শুধু অ্যাডমিন) ইউজার তালিকা
      `;
      await sendMessage(chatId, msg);
      return res.status(200).send("ok");
    }

    // ==============================
    // 🧩 /about কমান্ড
    // ==============================
    if (text.startsWith("/about")) {
      const aboutMsg = `
🤖 <b>Facebook Info Bot</b>  
🌐 ফেসবুক প্রোফাইল লিংক থেকে নাম, ইউজারনেম/আইডি এবং প্রোফাইল ছবি বের করে দেয়।

👨‍💻 <b>ডেভেলপার:</b> Rana Ahmed  
💬 GitHub: <a href="https://github.com/ranaahmeddev">ranaahmeddev</a>  
🌎 Website: <a href="https://ranaahmed.vercel.app">ranaahmed.vercel.app</a>  
🗓️ Deployed: 12 Nov 2025

📢 Node.js (Vercel Serverless) + Telegram Bot API
`;
      await sendMessage(chatId, aboutMsg, { parse_mode: "HTML" });
      return res.status(200).send("ok");
    }

    // ==============================
    // 🧩 /users কমান্ড (শুধু অ্যাডমিন)
    // ==============================
    if (text.startsWith("/users")) {
      if (user.id.toString() !== ADMIN_ID) {
        await sendMessage(chatId, "❌ এই কমান্ড শুধুমাত্র অ্যাডমিনের জন্য।");
        return res.status(200).send("unauthorized");
      }

      if (users.length === 0) {
        await sendMessage(chatId, "📭 এখনো কোনো ইউজার বট চালু করেনি।");
      } else {
        let msg = `👥 মোট ইউজার: ${users.length}\n\n`;
        users.forEach((u, i) => {
          msg += `${i + 1}. ${u.name} (${u.username ? "@" + u.username : "No username"})\n🆔 ${u.id}\n\n`;
        });
        await sendMessage(chatId, msg);
      }
      return res.status(200).send("ok");
    }

    // ==============================
    // 📎 Facebook Profile Processing
    // ==============================
    const [fbId, username] = extractFbIdOrUsername(text);
    if (!fbId && !username) {
      await sendMessage(chatId, "❌ দয়া করে একটি সঠিক Facebook প্রোফাইল লিংক দিন।");
      return res.status(200).send("invalid");
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
      return res.status(200).send("fail");
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
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
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
