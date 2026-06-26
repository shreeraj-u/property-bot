require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { handleIncomingMessage, handleFirstMessage } = require('./bot/handler');

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function normalizePhone(from) {
  let phone = (from?.replace('whatsapp:', '') || from || '').trim();
  if (phone && !phone.startsWith('+')) {
    phone = `+${phone}`;
  }
  return phone;
}

function validateTwilioRequest(req, res, next) {
  if (process.env.NODE_ENV === 'test' || process.env.SKIP_TWILIO_VALIDATION === '1') {
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  const url =
    process.env.WEBHOOK_URL ||
    `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const valid = twilio.validateRequest(
    authToken,
    signature,
    url,
    req.body || {}
  );

  if (!valid) {
    return res.status(403).send('Invalid Twilio signature');
  }

  return next();
}

const TWILIO_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 12000);

function withWebhookTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('webhook timeout')), TWILIO_TIMEOUT_MS);
    }),
  ]);
}

app.post('/webhook', validateTwilioRequest, async (req, res) => {
  const from = normalizePhone(req.body.From);
  const body = req.body.Body || '';

  console.log(`Message from ${from}: ${body}`);

  const twiml = new twilio.twiml.MessagingResponse();
  const started = Date.now();

  try {
    const trimmed = body.trim();
    const isGreeting =
      !trimmed ||
      ['hi', 'hello', 'hey', 'start', 'menu'].includes(trimmed.toLowerCase());

    const messages = await withWebhookTimeout(
      isGreeting
        ? handleFirstMessage(from)
        : handleIncomingMessage(from, body)
    );

    for (const msg of messages) {
      twiml.message(msg);
    }

    console.log(`Reply sent in ${Date.now() - started}ms`);
  } catch (err) {
    console.error('Webhook error:', err.message || err);
    if (err.message === 'webhook timeout') {
      twiml.message(
        'Sorry, that took too long. Please try again — e.g. "next rent payment for David Lim" or type help.'
      );
    } else {
      twiml.message('Something went wrong. Please try again or type menu.');
    }
  }

  res.type('text/xml').send(twiml.toString());
});

app.get('/', (req, res) => res.send('Property bot is running'));

if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
  });
}

module.exports = app;
