// api/qr.js
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { makeid } = require('../gen-id');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const sessionId = makeid(6);
  const sessionPath = path.join('/tmp', sessionId);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Red X Pair', 'Chrome', '1.0.0']
    });

    let qrSent = false;
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !qrSent && !res.headersSent) {
        qrSent = true;
        try {
          const qrBuffer = await QRCode.toBuffer(qr);
          res.end(qrBuffer);
        } catch (err) {
          console.error('QR buffer error:', err);
          if (!res.headersSent) res.status(500).end();
        }
      }

      if (connection === 'open') {
        await delay(5000);
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const sessionData = fs.readFileSync(credsPath, 'utf-8');
          const base64 = Buffer.from(sessionData).toString('base64');
          const prefixed = `RED-X~${base64}`;
          
          await sock.sendMessage(sock.user.id, { text: '*✅ RED-X SESSION ID*' });
          await sock.sendMessage(sock.user.id, { text: prefixed });
        }
        
        await sock.ws.close();
        fs.rmSync(sessionPath, { recursive: true, force: true });
      } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log('QR connection closed unexpectedly');
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.error('Fatal error:', error);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).end();
  }
};
