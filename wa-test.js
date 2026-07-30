const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const TARGET_NUMBER = '628111441757@s.whatsapp.net';
const OWNER_PHONE = "628111441757";

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingCodeRequested = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if ((connection === 'connecting' || qr) && !sock.authState.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true;
            try {
                // A slight delay is recommended by Baileys before requesting a pairing code
                setTimeout(async () => {
                    const code = await sock.requestPairingCode(OWNER_PHONE);
                    console.log("PAIRING CODE:", code);
                }, 2000);
            } catch (err) {
                console.error("Failed to request pairing code:", err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log('Connection closed. Reason/Status Code:', statusCode);

            if (shouldReconnect) {
                console.log('Reconnecting to WhatsApp...');
                connectToWhatsApp();
            } else {
                console.log('Connection closed. You are logged out. Please delete the ./auth folder and restart.');
            }
        } else if (connection === 'open') {
            console.log('WhatsApp connection opened successfully!');
            
            sock.sendMessage(TARGET_NUMBER, { text: 'Bot online ✅' })
                .then(() => console.log(`Successfully sent "Bot online ✅" message to ${TARGET_NUMBER}`))
                .catch(err => console.error('Error sending message:', err));
        }
    });
}

connectToWhatsApp();
