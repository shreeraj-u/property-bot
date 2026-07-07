# Property Bot 🏠💬

A WhatsApp-based property management assistant that helps property managers and tenants handle rent, leases, complaints, payment proof submissions, vacant units, and tenant information through a simple chat interface.

Property Bot is designed for property managers who already communicate with tenants on WhatsApp but need a more organized system for tracking tenant requests, rent status, lease documents, and complaints.

---

## 🚀 Overview

Property Bot turns WhatsApp into a lightweight property management system.

Tenants can message the bot to:

* Check their rent payment status
* View lease information
* File complaints
* Submit rent payment proof screenshots

Property managers can message the bot to:

* View rent summaries
* Check who has paid, missed, or still owes rent
* Look up tenant details
* View expiring leases
* Access lease documents
* See open complaints
* View vacant units
* Generate a secure dashboard login link

The system also includes a web dashboard for managing rent, complaints, tenants, lease documents, and payment proof approvals.

---

## ✨ Features

### 👤 Tenant WhatsApp Flows

Tenants can interact with the bot directly from WhatsApp.

Current tenant features include:

* **Rent Status**
  Tenants can check whether their rent is paid, pending, or overdue.

* **Lease Information**
  Tenants can view their active lease information and access lease documents when available.

* **Complaint Filing**
  Tenants can file complaints under categories such as:

  * Maintenance
  * Noise
  * Other

* **Rent Proof Uploads**
  Tenants can upload payment proof screenshots, such as bank transfer receipts, directly through WhatsApp.

* **Session-Based Conversations**
  The bot tracks conversation state so tenants can move through multi-step flows like filing complaints or submitting payment proof.

---

### 🧑‍💼 Property Manager WhatsApp Assistant

The manager can use natural language commands over WhatsApp to query the property database.

Example questions the manager can ask:

```txt
How much rent was collected this month?
Who has overdue rent?
Show me pending rent for block A.
Which leases are expiring soon?
Find tenant Aisha Rahman.
Send me the lease document for A-05-12.
Show open maintenance complaints.
Which units are vacant?
Send me the dashboard link.
```

The manager assistant supports:

* Rent summaries
* Rent roll views
* Tenant lookups
* Lease document retrieval
* Expiring lease checks
* Complaint tracking
* Vacant unit lists
* Dashboard magic links

---

### 🧠 AI-Powered Message Routing

The bot uses Claude through the Anthropic SDK to route manager messages to the correct backend tool.

Supported manager tools include:

* `rent_summary`
* `rent_roll`
* `expiring_leases`
* `tenant_lookup`
* `lease_document`
* `open_complaints`
* `vacant_units`
* `dashboard_link`
* `help`

There is also keyword-based fallback routing so the bot can still respond to common queries even when LLM routing is unavailable.

---

### 📊 Web Dashboard

The project includes a web dashboard with authenticated access.

Dashboard sections include:

* Overview
* Rent board
* Documents
* Payment proofs
* Complaints
* Tenants
* Vacant units

Managers can use the dashboard to:

* View property-level rent statistics
* See rent collection status by unit
* Approve or reject tenant payment proof submissions
* View lease records and documents
* Update complaint statuses
* Search tenants
* View vacant units

---

## 🛠️ Tech Stack

* **Node.js**
* **Express.js**
* **Twilio WhatsApp API**
* **Supabase**
* **PostgreSQL**
* **Supabase Storage**
* **Anthropic Claude API**
* **HTML, CSS, JavaScript**
* **Node Test Runner**
* **Supertest**

---

## 📁 Project Structure

```txt
property-bot/
├── bot/
│   ├── formatters.js
│   ├── handler.js
│   ├── keywordRouter.js
│   ├── managerFlows.js
│   ├── media.js
│   ├── rentProofManager.js
│   ├── session.js
│   ├── tenantFlows.js
│   └── toolParams.js
│
├── lib/
│   └── dashboardAuth.js
│
├── public/
│   └── dashboard/
│       ├── app.js
│       ├── index.html
│       ├── login.html
│       └── styles.css
│
├── routes/
│   └── dashboard.js
│
├── scripts/
│   └── seed.js
│
├── tests/
│   └── webhook.test.js
│
├── llm.js
├── server.js
├── supabase.js
├── package.json
└── .env.example
```

---

## ⚙️ Installation

Clone the repository:

```bash
git clone https://github.com/shreeraj-u/property-bot.git
cd property-bot
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Then add the required environment variables.

---

## 🔐 Environment Variables

Create a `.env` file in the root directory.

```env
PORT=3000

# Supabase
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Property manager phone number
MANAGER_PHONE=+65XXXXXXXX

# Webhook configuration
WEBHOOK_URL=https://your-domain.com/webhook
ASYNC_WEBHOOK=1

# Anthropic / Claude
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-haiku-4-5
LLM_TIMEOUT_MS=8000

# Dashboard auth
DASHBOARD_SECRET=your_dashboard_secret
DASHBOARD_PASSWORD=your_dashboard_password
DASHBOARD_BASE_URL=https://your-domain.com
```

> Do not commit your real `.env` file or service keys to GitHub.

---

## ▶️ Running Locally

Start the server:

```bash
npm start
```

Or run in development mode:

```bash
npm run dev
```

The server should start on:

```txt
http://localhost:3000
```

Health check:

```txt
GET /
```

Expected response:

```txt
Property bot is running
```

---

## 🌱 Seeding Demo Data

The project includes a seed script for creating sample units, tenants, leases, rent payments, and complaints.

Run:

```bash
npm run seed
```

This runs:

```bash
node scripts/seed.js --reset
```

The seed data includes:

* 30 units
* Sample tenants
* Active leases
* Rent payments
* Complaint records
* Vacant units

---

## 🧪 Running Tests

Run the test suite:

```bash
npm test
```

The tests cover core webhook behavior, including:

* Health check response
* Manager greeting flow
* Unknown sender handling
* Manager proof approval command routing

---

## 📲 Twilio WhatsApp Setup

To connect the bot to WhatsApp:

1. Create or open your Twilio project.
2. Enable the WhatsApp Sandbox or configure a WhatsApp sender.
3. Set your webhook URL to:

```txt
https://your-domain.com/webhook
```

4. Make sure your deployed app has the correct Twilio environment variables.
5. Add your manager phone number to `MANAGER_PHONE`.

For local testing, expose your local server using a tunneling tool such as ngrok:

```bash
ngrok http 3000
```

Then use the generated public URL as your Twilio webhook URL:

```txt
https://your-ngrok-url.ngrok-free.app/webhook
```

---

## 💬 Example Tenant Flow

A registered tenant can message:

```txt
hi
```

The bot shows a menu where the tenant can choose options such as:

```txt
1. Check rent status
2. View lease information
3. File a complaint
4. Submit rent payment proof
```

Example complaint flow:

```txt
Tenant: 3
Bot: Pick a category: Maintenance, Noise, Other

Tenant: 1
Bot: Please describe the issue.

Tenant: Aircon is not cooling properly.
Bot: Confirm your complaint.

Tenant: YES
Bot: Your complaint has been submitted.
```

---

## 💬 Example Manager Commands

```txt
How much rent was collected this month?
```

```txt
Show me overdue tenants.
```

```txt
Which leases are expiring in the next 60 days?
```

```txt
Find tenant Benjamin Tan.
```

```txt
Show open complaints.
```

```txt
Which 2BR units are vacant?
```

```txt
Send dashboard link.
```

---

## 🧾 Rent Proof Approval Flow

Tenants can upload rent proof screenshots through WhatsApp.

The flow works like this:

1. Tenant selects the rent proof option.
2. Bot checks for pending or overdue rent payments.
3. Tenant uploads a JPEG or PNG screenshot.
4. Bot saves the proof to Supabase Storage.
5. Manager receives a WhatsApp notification.
6. Manager can approve or reject the proof.
7. Tenant is notified of the result.

Payment proofs can also be reviewed from the dashboard.

---

## 🖥️ Dashboard

The dashboard is available at:

```txt
/dashboard
```

The manager can log in using either:

* A dashboard password
* A magic login link generated through WhatsApp

The dashboard provides a visual interface for:

* Rent overview
* Rent collection status
* Proof submissions
* Lease documents
* Complaint management
* Tenant directory
* Vacant units

---

## 🧩 Core Backend Modules

### `server.js`

Main Express server. Handles:

* Twilio webhook requests
* Request validation
* Async WhatsApp replies
* Media payload resolution
* Dashboard routing
* Health check route

### `bot/handler.js`

Main message router. Decides whether the sender is:

* The property manager
* A registered tenant
* An unknown number

### `bot/tenantFlows.js`

Handles tenant-facing flows, including:

* Rent status
* Lease info
* Complaint filing
* Payment proof submission

### `bot/managerFlows.js`

Handles manager queries by executing tools such as:

* Rent roll
* Rent summary
* Tenant lookup
* Lease document lookup
* Complaint listing
* Vacant unit listing

### `llm.js`

Routes natural language manager messages to structured tools using Claude.

### `supabase.js`

Database and storage layer. Handles:

* Tenant lookup
* Rent payment queries
* Lease document links
* Complaint records
* WhatsApp sessions
* Proof uploads
* Dashboard data
* Twilio replies

### `routes/dashboard.js`

Dashboard authentication, pages, and API routes.

---

## 🚧 Current Limitations

This is an early version of the product. Some areas that can be improved include:

* Multi-property support
* Multiple manager accounts
* Role-based dashboard permissions
* Better tenant onboarding flow
* Production-grade audit logs
* More advanced complaint assignment workflows
* Automated rent reminders
* Lease renewal automation
* Cleaner `.env.example` documentation
* Full database schema migration files

---

## 🗺️ Future Improvements

Possible next features:

* Automated WhatsApp rent reminders
* Maintenance vendor assignment
* Multi-building support
* Tenant onboarding from CSV
* Lease renewal reminders
* Analytics for rent collection trends
* AI-generated complaint summaries
* Manager broadcast messages
* Payment gateway integration
* OCR for payment proof screenshots
* Admin panel for adding tenants and units
* Support for multiple property managers

---

## 📌 Why This Project Matters

Many property managers already rely heavily on WhatsApp to communicate with tenants, but WhatsApp alone is not structured enough for managing rent, complaints, leases, documents, and tenant records.

Property Bot bridges that gap by keeping WhatsApp as the main interface while adding database-backed workflows, AI routing, document access, proof uploads, and a dashboard for managers.

The goal is to make property management feel as simple as sending a message.

---

## 👨‍💻 Author

Built by [Shreeraj Uppalapati](https://github.com/shreeraj-u)

---

## 📄 License

This project is currently licensed under the ISC License.
