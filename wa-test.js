const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const TARGET_NUMBER = '628111441757@s.whatsapp.net';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
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
            
            sock.sendMessage(TARGET_NUMBER, { text: 'Bot online ✅' })
                .then(() => console.log(`Successfully sent "Bot online ✅" message to ${TARGET_NUMBER}`))
                .catch(err => console.error('Error sending message:', err));
        }
    });
}

connectToWhatsApp();
