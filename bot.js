import dotenv from "dotenv";
dotenv.config();

import express from "express";
import pino from "pino";
import fs from "fs";
import path from "path";
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState,
  isJidGroup, // Import isJidGroup
} from "@whiskeysockets/baileys";

const app = express();
const PORT = process.env.PORT || 3000;
const logger = pino({ level: "info" });
const sessionDir = path.join(process.cwd(), "session");
const antilinkConfigFile = path.join(process.cwd(), "antilink_config.json"); // Config file path

// Create session directory if it doesn't exist
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

// --- Antilink Settings ---
let antilinkSettings = {}; // In-memory store for antilink status per group

// Function to load antilink settings from file
function loadAntilinkSettings() {
  try {
    if (fs.existsSync(antilinkConfigFile)) {
      const data = fs.readFileSync(antilinkConfigFile, "utf8");
      antilinkSettings = JSON.parse(data);
      logger.info("Antilink settings loaded successfully.");
    } else {
      logger.info(
        "antilink_config.json not found, starting with empty settings."
      );
      antilinkSettings = {};
    }
  } catch (error) {
    logger.error("Failed to load antilink settings:", error);
    antilinkSettings = {}; // Reset settings on error
  }
}

// Function to save antilink settings to file
async function saveAntilinkSettings() {
  try {
    await fs.promises.writeFile(
      antilinkConfigFile,
      JSON.stringify(antilinkSettings, null, 2)
    );
    // logger.info("Antilink settings saved successfully."); // Optional: uncomment for debugging
  } catch (error) {
    logger.error("Failed to save antilink settings:", error);
  }
}
// --- End Antilink Settings ---

// Function to save session data to a file
async function saveSessionToFile(sessionData) {
  try {
    await fs.promises.writeFile(
      path.join(sessionDir, "creds.json"),
      typeof sessionData === "string"
        ? sessionData
        : JSON.stringify(sessionData)
    );
    logger.info("Session data saved successfully");
    return true;
  } catch (err) {
    logger.error("Failed to save session data:", err);
    return false;
  }
}

// --- isAdmin function ---
async function isAdmin(sock, chatId, senderId) {
  // Ensure it's a group chat before proceeding
  if (!isJidGroup(chatId)) {
    // console.log("isAdmin check skipped: Not a group chat.");
    return { isSenderAdmin: false, isBotAdmin: false };
  }
  try {
    const groupMetadata = await sock.groupMetadata(chatId);
    const botJidNormalized = sock.user.id.split(":")[0] + "@s.whatsapp.net";
    const participant = groupMetadata.participants.find(
      (p) => p.id === senderId
    );
    const bot = groupMetadata.participants.find(
      (p) => p.id === botJidNormalized
    );
    const isBotAdmin =
      bot && (bot.admin === "admin" || bot.admin === "superadmin");
    const isSenderAdmin =
      participant &&
      (participant.admin === "admin" || participant.admin === "superadmin");
    return { isSenderAdmin, isBotAdmin };
  } catch (error) {
    logger.error(
      "Error fetching group metadata or checking admin status:",
      error
    );
    return { isSenderAdmin: false, isBotAdmin: false };
  }
}
// --- End of isAdmin function ---

// --- containsURL function ---
function containsURL(str) {
  // More robust regex to catch various URL formats, including those without http/https
  // Handles domains, subdomains, IPs, ports, paths, query strings, fragments
  const urlRegex = new RegExp(
    "((?:https?|ftp):\\/\\/)?" + // Optional protocol
      "([\\w\\.-]+(?:\\.[\\w\\.-]+)+)" + // Domain name or IP
      "([\\w\\-\\._~:/?#[\\]@!\\$&'\\(\\)\\*\\+,;=.]+)?", // Path, query, fragment etc.
    "i" // Case insensitive
  );
  // Basic check to avoid matching common file names or short non-URLs like "file.js"
  if (str.length < 5 || !str.includes(".")) {
    return false;
  }
  return urlRegex.test(str);
}
// --- End of containsURL function ---

async function start() {
  // If SESSION_DATA environment variable exists, save it first
  if (process.env.SESSION_DATA) {
    await saveSessionToFile(process.env.SESSION_DATA);
  }

  // Load antilink settings on start
  loadAntilinkSettings();

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  logger.info(`🤖 Using WA v${version.join(".")}`);

  const Matrix = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    // browser: ['Chrome (Linux)', '', ''] // Optional: Set browser description
  });

  Matrix.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (
      connection === "close" &&
      lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
    ) {
      logger.warn("Reconnecting...");
      start();
    } else if (connection === "open") {
      logger.info("✅ Connected successfully!");
    }
  });

  Matrix.ev.on("creds.update", async (creds) => {
    await saveCreds();
    // Log the session data for deployment
    if (process.env.NODE_ENV === "production") {
      try {
        const sessionData = await fs.promises.readFile(
          path.join(sessionDir, "creds.json"),
          "utf8"
        );
        logger.info(
          "New session data (save this as SESSION_DATA env variable):"
        );
        // logger.info(sessionData); // Avoid logging sensitive data directly unless necessary
      } catch (readError) {
        logger.error("Failed to read session data for logging:", readError);
      }
    }
  });

  // Handle incoming messages
  Matrix.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      // Ignore messages without content or key, and messages from the bot itself
      if (!message.message || !message.key || message.key.fromMe) continue;

      const chatId = message.key.remoteJid; // Chat ID (group or individual)
      // Determine sender ID (participant in groups, remoteJid otherwise)
      const senderId = message.key.participant || message.key.remoteJid;
      const isGroup = isJidGroup(chatId); // Check if it's a group chat

      const messageText =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        "";

      if (!messageText) continue; // Ignore messages with no text content

      // --- Antilink Logic ---
      if (
        isGroup &&
        antilinkSettings[chatId]?.enabled &&
        containsURL(messageText)
      ) {
        try {
          const { isSenderAdmin } = await isAdmin(Matrix, chatId, senderId);
          if (!isSenderAdmin) {
            logger.info(
              `Antilink triggered in ${chatId} by ${senderId}. Deleting message.`
            );
            await Matrix.sendMessage(chatId, { delete: message.key });
            // Send warning message (optional, can be customized)
            await Matrix.sendMessage(chatId, {
              text: `\`\`\`@${
                senderId.split("@")[0]
              }, links are not allowed here!\`\`\``,
              mentions: [senderId],
            });
            continue; // Stop processing this message further if link was deleted
          } else {
            // logger.info(`Link detected from admin ${senderId} in ${chatId}. Allowed.`); // Optional logging
          }
        } catch (antilinkError) {
          logger.error(
            `Error during antilink check for ${chatId}:`,
            antilinkError
          );
        }
      }
      // --- End Antilink Logic ---

      // --- Command Handling ---
      const command = messageText.toLowerCase().split(" ")[0]; // Get the first word as command

      if (command === "/menu") {
        await Matrix.sendMessage(chatId, {
          text: `Welcome to Franco Store! ❤\n\nHere are our available commands:\n\n*Commands:*\n💠 /menu - View all commands\n💠 /packs - View all diamond packs and prices\n💠 /eventp - View diamond packs for event tasks\n💠 /dd - View double diamond packs\n💠 /rb - MLBB Rank Boosting Service\n💠 /qr - Get Paytm QR code\n\n*Group Admin Commands:*\n💠 /check - Check if you are an admin (Group only)\n💠 /antilink on - Disable links for non-admins\n💠 /antilink off - Allow links for everyone\n\nNeed help?\nJust send any of these commands to get started!`,
        });
      } else if (command === "/packs") {
        await Matrix.sendMessage(chatId, {
          text: `❤FRANCO STORE❤\n\n   via id server recharge\n\n20% off on bulk for regular customer💠\n\nSMALL PACKS 🥹🤧\n\n5💎= 15₹(Recharge any amount task)\n11💎= 20₹\n14💎= 30₹\n22💎= 40₹\n28💎= 55₹\n42💎= 70₹\n56💎= 85₹ (50💎 task)\n86💎= 105₹(50💎 task)\n112💎= 155₹(100💎 task)\n172💎= 210₹(100💎 task)\n257💎= 315₹\n279💎= 360₹(250💎 task)\n344💎= 420₹(250💎 task)\n429💎= 525₹\n514💎= 630₹\n619💎= 735₹(500💎 task)\n706💎= 840₹\n1050💎= 1300₹\n1412💎= 1650₹\n1926💎= 2280₹\n2195💎= 2500₹\n3688💎= 4100₹\n5532💎= 6100₹\n6042💎= 7400₹\n9288💎= 10000₹\n20074💎= 25000₹\n\nTWILIGHT PASS 700₹💠❤\nWEEKLY PASS 130₹💠❤\n\nDM TO ORDER SMALL❤:\nTap here to order👇🏻\nhttps://wa.me/+919175339978?text=Hi,+WALL-E+I+need+MLBB+Recharge%0AID%3D%0AServer%3D\n\nGpay,Paytm,Binance: 7507579178\n\nGroup 1\nhttps://chat.whatsapp.com/E1dG0eBGwRZDUA3crNmi4P`,
        });
      }
      //double diamonds
      else if (command === "/dd") {
        await Matrix.sendMessage(chatId, {
          text: `*Franco Store*💠❤\n\n*Double Diamond packs*💠💎\n*5 min process*\n*All packs can be bought for one time only*\n\n• 50+50 💎 = ₹100\n• 150+150 💎 = ₹240\n• 250+250 💎 = ₹350\n• 500+500 💎 = ₹660\n\n*How to Order:*\nTap here to order 👇🏻\nhttps://wa.me/+919175339978?text=Hi,+WALL-E+I+need+MLBB+Recharge%0AID%3D%0AServer%3D`,
        });
      } else if (command === "/eventp") {
        await Matrix.sendMessage(chatId, {
          text: `FRANCO STORE💠❤\nAlpha phase 2 Pre-Order💠❤\n\nRecommend Packs💠💎\n\n( Recharge any amount task)🧧\n5💎= 12₹\n\n(To Complete 50💎 task)🧧\n56💎= 85₹\n86💎= 110₹\n\n(To Complete 100💎 task)🧧\n112💎= 150₹\n172💎= 215₹\nWeekly Pass💎= 130₹\n\n(To Complete 250💎 task)🧧\n279💎= 350₹\n343💎= 455₹\n3 Weekly Pass💎= 385₹\n\n(To Complete 500💎 task)🧧\n600💎= 710₹\n\n(To Complete 1000💎 task)🧧\n1135💎= 1300₹\n\nTap here to order👇🏻\nhttps://wa.me/+919175339978?text=Hi,+WALL-E+I+need+MLBB+Pre-Order+Recharge%0AID%3D%0AServer%3D`,
        });
      } else if (command === "/rb") {
        await Matrix.sendMessage(chatId, {
          text: `FRANCO STORE💠❤\n\nMLBB RANK BOOSTING SERVICE💠\n\nEPIC TO LEGEND Rs 350|| 4 USDT 1 Day\n\nLEGEND  TO MYTHIC Rs 450 || 6 USDT 1 Day\n\nMYTHIC PLACEMENT  TO MYTHIC  HONOR Rs 750 || 9 USDT 2 Days\n\nMYTHIC HONOR  ABOVE Rs 35 || 0.50 USDT (Per star)\n\nMYTHIC GLORY ABOVE Rs 40 || 0.60 USDT (Per Star)\n\nIMMORTAL ABOVE Rs 50 || 0.80 USDT  (Per Star)\n\nNOTE: Account  will be boosted by Global Squads.\n\nRules for boosting\n1) Only Facebook and Montoon login is accepted for mlbb boosting.\n\n2) Customer shouldn\'t login his/her account until boosting is done.\n\n3) incase if customer login n disturbs the booster for continuously boosting will be cancelled n there is no refund in this case.\n\n4) accounts Will be boosted by professionals with 80+ Winrates \n\nTo place order dm \nhttps://Wa.me/+919175339978`,
        });
      } else if (command === "/qr") {
        try {
          await Matrix.sendMessage(chatId, {
            image: fs.readFileSync("./paytmqr.jpg"),
            caption: "Paytm QR Code",
          });
        } catch (qrError) {
          logger.error("Error sending QR code:", qrError);
          await Matrix.sendMessage(chatId, {
            text: "Sorry, couldn't send the QR code image.",
          });
        }
      }
      // --- /check command ---
      else if (command === "/check") {
        if (!isGroup) {
          await Matrix.sendMessage(chatId, {
            text: "This command can only be used in group chats.",
          });
          continue; // Skip further processing for this message
        }
        try {
          // Call isAdmin function (Matrix is the sock object here)
          const { isSenderAdmin } = await isAdmin(Matrix, chatId, senderId);

          let replyText = "";
          if (isSenderAdmin) {
            replyText = `✅ Yes, @${
              senderId.split("@")[0]
            } is an admin in this group.`;
          } else {
            replyText = `❌ No, @${
              senderId.split("@")[0]
            } is not an admin in this group.`;
          }

          await Matrix.sendMessage(chatId, {
            text: replyText,
            mentions: [senderId], // Mention the user who sent the command
          });
        } catch (adminCheckError) {
          logger.error(
            "Error during /check command execution:",
            adminCheckError
          );
          await Matrix.sendMessage(chatId, {
            text: "Sorry, couldn't check admin status due to an error.",
          });
        }
      }
      // --- End of /check command ---

      // --- /antilink command ---
      else if (command === "/antilink") {
        if (!isGroup) {
          await Matrix.sendMessage(chatId, {
            text: "This command can only be used in group chats.",
          });
          continue;
        }
        try {
          const { isSenderAdmin } = await isAdmin(Matrix, chatId, senderId);
          if (!isSenderAdmin) {
            await Matrix.sendMessage(chatId, {
              text: `❌ Sorry @${
                senderId.split("@")[0]
              }, only group admins can use this command.`,
              mentions: [senderId],
            });
            continue;
          }

          const subCommand = messageText.toLowerCase().split(" ")[1]; // Get 'on' or 'off'
          if (subCommand === "on") {
            antilinkSettings[chatId] = { enabled: true };
            await saveAntilinkSettings();
            await Matrix.sendMessage(chatId, {
              text: "✅ Antilink has been enabled. Links from non-admins will be deleted.",
            });
          } else if (subCommand === "off") {
            antilinkSettings[chatId] = { enabled: false };
            await saveAntilinkSettings();
            await Matrix.sendMessage(chatId, {
              text: "❎ Antilink has been disabled. Everyone can send links.",
            });
          } else {
            await Matrix.sendMessage(chatId, {
              text: "Usage: `/antilink on` or `/antilink off`",
            });
          }
        } catch (error) {
          logger.error("Error processing /antilink command:", error);
          await Matrix.sendMessage(chatId, {
            text: "Sorry, an error occurred while processing the antilink command.",
          });
        }
      }
      // --- End of /antilink command ---
    }
  });
}

async function init() {
  logger.info("🔒 Starting bot...");
  try {
    await start();
  } catch (error) {
    logger.fatal("Failed to initialize bot:", error);
    process.exit(1); // Exit if initialization fails
  }
}

init();

app.get("/", (req, res) => res.send("WhatsApp Bot is running!"));
app.listen(PORT, () =>
  logger.info(`Server running on http://localhost:${PORT}`)
);

// Basic error handling for unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Application specific logging, throwing an error, or other logic here
});
