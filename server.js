// server.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/webhook', async (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '') || req.body.From;
  const body = req.body.Body;

  console.log(`📩 Message from ${from}: ${body}`);

  // Echo reply for now — agent.js gets wired in next
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(`✅ Bot received: "${body}"`);
  res.type('text/xml').send(twiml.toString());
});

// Health check — Railway uses this
app.get('/', (req, res) => res.send('Property bot is running'));

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
