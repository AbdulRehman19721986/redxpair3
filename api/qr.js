// api/qr.js
const { makeid } = require('../gen-id');
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const sessionId = makeid(6);
  const sessionPath = path.join('/tmp', sessionId);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    let qrSent = false;

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect, qr } = s;
      if (qr && !qrSent && !res.headersSent) {
        qrSent = true;
        const qrImage = await QRCode.toBuffer(qr);
        res.end(qrImage);
      }

      if (connection === 'open') {
        await delay(5000);
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const sessionData = fs.readFileSync(credsPath, 'utf-8');
          const base64 = Buffer.from(sessionData).toString('base64');
          const prefixed = `RED-X~${base64}`;

          await sock.sendMessage(sock.user.id, { text: '✅ *Your RED X Session ID*' });
          await sock.sendMessage(sock.user.id, { text: prefixed });
        }

        await delay(1000);
        await sock.ws.close();
        fs.rmSync(sessionPath, { recursive: true, force: true });
      } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log('QR connection closed');
      }
    });
  } catch (err) {
    console.error(err);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).end();
  }
};
