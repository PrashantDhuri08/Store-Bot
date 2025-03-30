const qrcode = require("qrcode-terminal");
const { Client, MessageMedia } = require("whatsapp-web.js");
// const axios = require("axios");

const client = new Client();

client.on("ready", () => {
  console.log("Client is ready!");
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Scan the QR code above to log in.");
});

client.on("message", async (msg) => {
  try {
    if (msg.body.toLowerCase() === "hi") {
      const commandList = `*Welcome to Franco Store!* ❤

Here are our available commands:

*Commands:*
• /packs - View all diamond packs and prices
• /dd - View double diamond packs
• /qr - Get Paytm QR code


*Need help?*
Just send any of these commands to get started! 💠`;

      await msg.reply(commandList);
    } else if (msg.body === "/packs") {
      const priceList = `❤ *FRANCO STORE* ❤

*Via ID Server Recharge*

💠 *20% off on bulk for regular customer*

*SMALL PACKS* 🥹🤧

*Basic Packs:*
• 5💎 = 15₹ (Recharge any amount task)
• 11💎 = 20₹
• 14💎 = 30₹
• 22💎 = 40₹
• 28💎 = 55₹
• 42💎 = 70₹

*Medium Packs:*
• 56💎 = 85₹ (50💎 task)
• 86💎 = 105₹ (50💎 task)
• 112💎 = 155₹ (100💎 task)
• 172💎 = 210₹ (100💎 task)
• 257💎 = 315₹
• 279💎 = 360₹ (250💎 task)
• 344💎 = 420₹ (250💎 task)

*Large Packs:*
• 429💎 = 525₹
• 514💎 = 630₹
• 619💎 = 735₹ (500💎 task)
• 706💎 = 840₹
• 1050💎 = 1300₹
• 1412💎 = 1650₹
• 1926💎 = 2280₹
• 2195💎 = 2500₹

*Premium Packs:*
• 3688💎 = 4100₹
• 5532💎 = 6100₹
• 6042💎 = 7400₹
• 9288💎 = 10000₹
• 20074💎 = 25000₹

*Special Passes:*
• TWILIGHT PASS = 700₹ 💠
• WEEKLY PASS = 140₹ 💠

*How to Order:*
Tap here to order 👇🏻
https://wa.me/+919175339978?text=Hi,+WALL-E+I+need+MLBB+Recharge%0AID%3D%0AServer%3D

*Payment Methods:*
• GPay: 7507579178
• Paytm: 7507579178@ptyes
• Binance: 7507579178

*Join Our Group:*
https://chat.whatsapp.com/E1dG0eBGwRZDUA3crNmi4P`;

      await msg.reply(priceList);
    } else if (msg.body === "/dd") {
      const doubleDiamondList = `*Franco Store*💠❤

*Double Diamond packs*💠💎
*5 min process*
*All packs can be bought for one time only*

• 50+50 💎 = ₹100
• 150+150 💎 = ₹240
• 250+250 💎 = ₹350
• 500+500 💎 = ₹660

*How to Order:*
Tap here to order 👇🏻
https://wa.me/+919175339978?text=Hi,+WALL-E+I+need+MLBB+Recharge%0AID%3D%0AServer%3D`;

      await msg.reply(doubleDiamondList);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    await msg.reply("Sorry, there was an error processing your request.");
  }
});

client.on("message", async (msg) => {
  if (msg.body === "/qr") {
    const media = MessageMedia.fromFilePath("./assets/paytmqr.jpg");
    await client.sendMessage(msg.from, media);
  }
});

client.initialize();
