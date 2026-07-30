require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

// 6. Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// 3. Environment variables
const POLL_CRON_SCHEDULE = process.env.POLL_CRON_SCHEDULE || "*/5 * * * *";
const ASSET_IDS_STR = process.env.ASSET_IDS || "4390890198";
const ASSET_IDS = ASSET_IDS_STR.split(',').map(id => id.trim()).filter(id => id);
const OWNER_JID = process.env.OWNER_JID || "628111441757@s.whatsapp.net";

const db = new Database('db.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS price_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id TEXT,
    rap INTEGER,
    checked_at TEXT
)`);

let sock = null; // Global socket reference for sending messages
let isPolling = false; // 4. Lockfile-based guard for polling

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('Please scan this QR code with WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log('Connection closed. Reason/Status Code:', statusCode);

            if (shouldReconnect) {
                console.log('Reconnecting to WhatsApp...');
                connectToWhatsApp();
            } else {
                console.log('Connection closed. You are logged out. Please delete the ./auth folder and restart to re-scan the QR code.');
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connection opened successfully!');
            // 5. On startup, send a message to OWNER_JID
            try {
                await sock.sendMessage(OWNER_JID, { text: `Bot started, tracking ${ASSET_IDS.length} items.` });
                console.log(`Sent startup message to ${OWNER_JID}`);
            } catch (err) {
                console.error('Error sending startup message:', err);
            }
        }
    });
}

// 1. Fetch with retry logic (exponential backoff)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchRolimonsData(retries = 3, backoff = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get('https://www.rolimons.com/itemapi/itemdetails', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://www.rolimons.com/'
                },
                timeout: 10000 // 10s timeout
            });
            return response.data;
        } catch (error) {
            const status = error.response ? error.response.status : error.message;
            console.warn(`[Attempt ${attempt}/${retries}] Fetch failed: ${status}`);
            
            if (attempt === retries) {
                throw error;
            }
            
            // Exponential backoff
            await delay(backoff);
            backoff *= 2;
        }
    }
}

async function checkPrices() {
    if (!sock) {
        console.log("WhatsApp not connected yet. Skipping this poll.");
        return;
    }

    // 4. Lockfile-based guard
    if (isPolling) {
        console.log("Previous poll is still running. Skipping this poll cycle.");
        return;
    }
    
    isPolling = true;

    try {
        const data = await fetchRolimonsData();
        const items = data.items;

        for (const assetId of ASSET_IDS) {
            if (!items || !items[assetId]) {
                console.log(`[${assetId}] not found in Rolimons database`);
                continue;
            }

            const itemData = items[assetId];
            const name = itemData[0];
            const currentRap = itemData[2];
            const checkedAt = new Date().toISOString();

            // Get previous reading
            const prevRow = db.prepare(`SELECT rap FROM price_log WHERE asset_id = ? ORDER BY id DESC LIMIT 1`).get(assetId);
            
            let notified = false;

            if (prevRow) {
                const prevRap = prevRow.rap;
                if (currentRap < prevRap) {
                    const msg = `📉 ${name} RAP dropped to ${currentRap} Robux (was ${prevRap})`;
                    await sock.sendMessage(OWNER_JID, { text: msg });
                    notified = true;
                } else if (currentRap > prevRap) {
                    const msg = `📈 ${name} RAP rose to ${currentRap} Robux (was ${prevRap})`;
                    await sock.sendMessage(OWNER_JID, { text: msg });
                    notified = true;
                }
            } else {
                console.log(`[${assetId}] First run, no previous data. Logging current RAP.`);
            }

            // Insert new reading
            db.prepare(`INSERT INTO price_log (asset_id, rap, checked_at) VALUES (?, ?, ?)`).run(assetId, currentRap, checkedAt);

            console.log(`[POLL] Item: ${name} (${assetId}) | RAP: ${currentRap} | Notified: ${notified}`);
        }
    } catch (error) {
        // 2. If API call fails after retries, log the error but don't crash the cron job
        if (error.response) {
            console.error(`HTTP Error during price check after retries: ${error.response.status} - ${error.response.statusText}`);
        } else {
            console.error(`Error during price check after retries: ${error.message}`);
        }
    } finally {
        isPolling = false; // release lock
    }
}

// Start WhatsApp
connectToWhatsApp();

// Schedule poll
cron.schedule(POLL_CRON_SCHEDULE, () => {
    console.log("Running scheduled price check...");
    checkPrices();
});
