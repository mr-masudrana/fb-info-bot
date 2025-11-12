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

    // ==============================
    // 🧩 /start কমান্ড
    // ==============================
    if (text.startsWith("/start")) {
      const welcomeText = `
👋 হ্যালো! আমি Facebook Info Bot 🤖  
আমি ফেসবুক প্রোফাইল লিংক থেকে নাম, ইউজারনেম/আইডি এবং প্রোফাইল ছবি বের করতে পারি।

🧭 উদাহরণ:
👉 https://facebook.com/zuck  
👉 https://facebook.com/profile.php?id=123456789  

🔹 সাহায্যের জন্য /help লিখুন।
      `;
      await sendMessage(chatId, welcomeText);
      return res.status(200).send("ok");
    }

    // ==============================
    // 🧩 /help কমান্ড
    // ==============================
    if (text.startsWith("/help")) {
      const helpText = `
📘 সাহায্য কেন্দ্র:

🪪 ফেসবুক প্রোফাইল তথ্য দেখতে শুধু প্রোফাইল লিংক পাঠান।  
যেমন:
https://facebook.com/zuck  
অথবা  
https://facebook.com/profile.php?id=123456789  

⚙️ কমান্ড তালিকা:
• /start — বট চালু করুন  
• /help — সাহায্য দেখুন  
• /about — বট সম্পর্কিত তথ্য দেখুন
      `;
      await sendMessage(chatId, helpText);
      return res.status(200).send("ok");
    }

    // ==============================
    // 🧩 /about কমান্ড
    // ==============================
    if (text.startsWith("/about")) {
      const aboutText = `
🤖 <b>Facebook Info Bot</b>  
🌐 <i>বটের কাজ:</i> ফেসবুক প্রোফাইল লিংক থেকে নাম, ইউজারনেম বা আইডি, এবং প্রোফাইল ছবি দেখানো।

👨‍💻 <b>ডেভেলপার:</b> Rana Ahmed  
💬 GitHub: <a href="https://github.com/ranaahmeddev">ranaahmeddev</a>  
🌎 Website: <a href="https://ranaahmed.vercel.app">ranaahmed.vercel.app</a>

📢 বটটি তৈরি করা হয়েছে Node.js (Vercel Serverless Function) এবং Telegram Bot API দিয়ে।
      `;

      await sendMessage(chatId, aboutText, { parse_mode: "HTML" });
      return res.status(200).send("ok");
    }

    // ==============================
    // 📎 Facebook Profile Processing
    // ==============================
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
