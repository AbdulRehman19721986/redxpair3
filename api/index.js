const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { makeid } = require('../gen-id');

const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Pairing endpoint
app.get('/pair', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Phone number required' });

  const cleanNumber = number.replace(/\D/g, '');
  if (cleanNumber.length < 10) return res.status(400).json({ error: 'Invalid number' });

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

    let codeSent = false;
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (!codeSent && !sock.authState.creds.registered) {
        try {
          const code = await sock.requestPairingCode(cleanNumber);
          codeSent = true;
          if (!res.headersSent) res.json({ code });
        } catch (err) {
          console.error('Pairing code error:', err);
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
    console.error(error);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).json({ error: 'Service unavailable' });
  }
});

// QR endpoint
app.get('/qr', async (req, res) => {
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
    console.error(error);
    fs.rmSync(sessionPath, { recursive: true, force: true });
    if (!res.headersSent) res.status(500).end();
  }
});

// Export the Express app as a serverless function
module.exports = app;
