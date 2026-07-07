require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { handleIncomingMessage, handleFirstMessage } = require('./bot/handler');
const { sendWhatsAppReply, checkSupabaseConnection, downloadTwilioMedia } = require('./supabase');
const { parseTwilioMedia } = require('./bot/media');

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const GREETINGS = new Set(['hi', 'hello', 'hey', 'start', 'menu']);
const USE_ASYNC_WEBHOOK =
  process.env.ASYNC_WEBHOOK !== '0' && process.env.NODE_ENV !== 'test';

function normalizePhone(from) {
  let phone = (from?.replace('whatsapp:', '') || from || '').trim();
  if (phone && !phone.startsWith('+')) {
    phone = `+${phone}`;
  }
  return phone;
}

function isGreeting(body) {
  const trimmed = (body || '').trim();
  return !trimmed || GREETINGS.has(trimmed.toLowerCase());
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

async function buildReplyMessages(from, body, mediaPayload) {
  const hasMedia = Boolean(mediaPayload?.buffer);
  if (!hasMedia && isGreeting(body)) {
    return handleFirstMessage(from);
  }
  return handleIncomingMessage(from, body, mediaPayload);
}

async function resolveMediaPayload(body) {
  const mediaMeta = parseTwilioMedia(body);
  if (!mediaMeta) return null;

  const { buffer, error } = await downloadTwilioMedia(mediaMeta.url);
  if (error) {
    console.error('Twilio media download failed:', error.message);
    return { ...mediaMeta, buffer: null, downloadError: error.message };
  }

  return { ...mediaMeta, buffer };
}

async function processWebhookAsync(from, body, mediaPayload) {
  const started = Date.now();

  try {
    const messages = await buildReplyMessages(from, body, mediaPayload);
    const { error } = await sendWhatsAppReply(from, messages);

    if (error) {
      console.error('Async reply failed:', error.message);
      return;
    }

    console.log(`Async reply sent in ${Date.now() - started}ms (${messages.length} message(s))`);
  } catch (err) {
    console.error('Async webhook error:', err.message || err);
    await sendWhatsAppReply(from, 'Something went wrong. Please try again or type menu.');
  }
}

app.post('/webhook', validateTwilioRequest, async (req, res) => {
  const from = normalizePhone(req.body.From);
  const body = req.body.Body || '';

  console.log(`Message from ${from}: ${body}${req.body.NumMedia ? ` (${req.body.NumMedia} media)` : ''}`);

  if (USE_ASYNC_WEBHOOK) {
    const mediaPayload = await resolveMediaPayload(req.body);
    res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
    setImmediate(() => {
      processWebhookAsync(from, body, mediaPayload);
    });
    return;
  }

  const twiml = new twilio.twiml.MessagingResponse();
  const started = Date.now();
  const mediaPayload = await resolveMediaPayload(req.body);

  try {
    const messages = await buildReplyMessages(from, body, mediaPayload);
    for (const msg of messages) {
      twiml.message(msg);
    }
    console.log(`Reply sent in ${Date.now() - started}ms`);
  } catch (err) {
    console.error('Webhook error:', err.message || err);
    twiml.message('Something went wrong. Please try again or type menu.');
  }

  res.type('text/xml').send(twiml.toString());
});

app.get('/', (req, res) => res.send('Property bot is running'));

if (require.main === module) {
  app.listen(process.env.PORT || 3000, async () => {
    console.log(
      `Server running on port ${process.env.PORT || 3000} (async webhook: ${USE_ASYNC_WEBHOOK})`
    );
    try {
      await checkSupabaseConnection();
    } catch (error) {
      console.error('Supabase startup check error:', error.message);
    }
  });
}

module.exports = app;
