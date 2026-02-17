// api/pair.js
const { makeid } = require('../gen-id');
const { default: makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Phone number required' });

  const cleanNumber = number.replace(/\D/g, '');
  if (cleanNumber.length < 10) return res.status(400).json({ error: 'Invalid number' });

  const sessionId = makeid(6);
  const sessionPath = path.join('/tmp', sessionId); // Vercel writable temp dir

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    let sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      browser: Browsers.macOS('Chrome'),
    });

    // If not registered, request pairing code
    if (!sock.authState.creds.registered) {
      await delay(1500);
      const code = await sock.requestPairingCode(cleanNumber);
      // Send code to frontend immediately
      if (!res.headersSent) res.json({ code });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect } = s;
      if (connection === 'open') {
        await delay(5000); // Wait for everything to settle

        // Read creds.json and send to user
        const credsPath = path.join(sessionPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const sessionData = fs.readFileSync(credsPath, 'utf-8');
          const base64 = Buffer.from(sessionData).toString('base64');
          const prefixed = `RED-X~${base64}`;

          await sock.sendMessage(sock.user.id, { text: '✅ *Your RED X Session ID*' });
          await sock.sendMessage(sock.user.id, { text: prefixed });

          // Optional fancy message
          const desc = `*┏━━━━━━━━━━━━━━┓*\n` +
                       `*┃  RED X PAIR  ┃*\n` +
                       `*┗━━━━━━━━━━━━━━┛*\n` +
                       `*Owner: Abdul Rehman Rajpoot*\n` +
                       `*GitHub: redx-pair-site*`;
          await sock.sendMessage(sock.user.id, { text: desc });
        }

        await delay(1000);
        await sock.ws.close();
        // Clean up temp folder
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`Session ${sessionId} completed`);
      } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
        // Reconnect if not logged out
        await delay(10000);
        // In serverless we can't restart easily, so just log
        console.log('Connection closed, will not restart in serverless');
      }
    });
  } catch (err) {
    console.error(err);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).json({ error: 'Service unavailable' });
  }
};
