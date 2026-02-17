const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { makeid } = require('../gen-id');

// Dynamically import Baileys (ESM)
let makeWASocket, useMultiFileAuthState, delay;
(async () => {
  const baileys = await import('@whiskeysockets/baileys');
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  delay = baileys.delay;
})();

const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/health', (req, res) => res.send('OK'));

// ---------- PAIRING ENDPOINT ----------
app.get('/pair', async (req, res) => {
  if (!makeWASocket) {
    return res.status(503).json({ error: 'Service initializing, try again' });
  }

  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Phone number required' });

  const cleanNumber = number.replace(/\D/g, '');
  if (cleanNumber.length < 10) return res.status(400).json({ error: 'Invalid number' });

  const sessionId = makeid(6);
  const sessionPath = path.join('/tmp', sessionId);
  fs.mkdirSync(sessionPath, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Red X Pair', 'Chrome', '1.0.0']
    });

    let codeSent = false;
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (!codeSent && !sock.authState.creds.registered) {
        try {
          const code = await sock.requestPairingCode(cleanNumber);
          codeSent = true;
          if (!res.headersSent) res.json({ code });
        } catch (err) {
          console.error('Pairing code error:', err);
          if (!res.headersSent) res.status(500).json({ error: 'Failed to get code' });
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
        console.log('Connection closed unexpectedly');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Fatal error:', error);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).json({ error: 'Service unavailable' });
  }
});

// ---------- QR ENDPOINT ----------
app.get('/qr', async (req, res) => {
  if (!makeWASocket) {
    return res.status(503).end('Service initializing, try again');
  }

  const sessionId = makeid(6);
  const sessionPath = path.join('/tmp', sessionId);
  fs.mkdirSync(sessionPath, { recursive: true });

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
          console.error('QR error:', err);
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
        console.log('QR connection closed');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('Fatal error:', error);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).end();
  }
});

// Export the Express app
module.exports = app;
