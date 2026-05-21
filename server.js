require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { identifySender } = require('./supabase');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post('/webhook', async (req, res) => {
  let from = (req.body.From?.replace('whatsapp:', '') || req.body.From || '').trim();
  if (from && !from.startsWith('+')) {
    from = `+${from}`;
  }
  const body = req.body.Body;

  console.log(`📩 Message from ${from}: ${body}`);

  const twiml = new twilio.twiml.MessagingResponse();

  try {
    const { tenant, isManager } = await identifySender(from);

    let reply;

    if (isManager) {
      reply = `👋 Welcome back, Manager. What would you like to know?`;
    } else if (tenant) {
      reply = `👋 Hi ${tenant.full_name}, Unit ${tenant.units?.unit_number}. How can I help you today?\n\n1. Check my rent status\n2. View lease info\n3. File a complaint`;
    } else {
      reply = `Sorry, your number isn't registered in our system. Please contact your property manager.`;
    }

    twiml.message(reply);
  } catch (err) {
    console.error('Error:', err);
    twiml.message('Something went wrong. Please try again.');
  }

  res.type('text/xml').send(twiml.toString());
});

app.get('/', (req, res) => res.send('Property bot is running'));

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});
