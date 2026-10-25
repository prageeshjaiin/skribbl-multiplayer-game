# Skribbl.io Clone — Production Ready Multiplayer Drawing & Guessing Game

[![Tests](https://img.shields.io/badge/tests-49%20passed%2C%200%20failed-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%20%7C%206.0-blue.svg)]()
[![React](https://img.shields.io/badge/React-19.3-61dafb.svg)]()
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-black.svg)]()
[![License](https://img.shields.io/badge/license-ISC-green.svg)]()

A full-stack, real-time multiplayer drawing and guessing game inspired by skribbl.io. Developed using **React 19**, **TypeScript**, **Vite**, **Node.js**, **Express**, **Socket.IO**, and **HTML5 Canvas**.

> **Live Deployment:** `[DEPLOYMENT_URL_PENDING_APPROVAL]` *(Configure with your live deployment URL on Render / Railway / Vercel)*

---

## 1. Feature Highlights

* **Real-Time Multiplayer Canvas**:
  * Pointer event tracking (Mouse, Touch, Stylus) with `lineCap: round` and `lineJoin: round`.
  * Normalized relative coordinates `(0.0 to 1.0)` for cross-device responsiveness.
  * DevicePixelRatio (DPI) awareness with `ResizeObserver` for crisp display without redraw artifacts.
  * 12-color palette, 4 brush sizes, eraser, server-validated undo, and canvas clear.
  * Touch gesture suppression on canvas (prevents page scrolling or pinch zoom during drawing).
* **Multiplayer Rooms & Lobby Management**:
  * 6-character room codes generated with crypto-randomness (ambiguous characters `0, O, 1, I` omitted).
  * Shareable invite links (`/?room=CODE`) with automatic code pre-population.
  * Host-configurable lobby settings: Max Players (2–20), Rounds (2–10), Draw Time (15–240s), Word Choices (1–5), Hints (0–5).
  * Capacity protection: host cannot reduce Max Players below the current occupancy count.
* **Server-Authoritative Game Engine**:
  * Explicit state machine: `LOBBY` ➔ `WORD_SELECTION` ➔ `DRAWING` ➔ `TURN_END` ➔ `GAME_OVER`.
  * Fair turn queue rotation guaranteeing every connected player draws once per round.
  * Word selection with 10-second countdown and automatic fallback pick.
  * Progressive letter hints unmasked at even timer intervals without revealing the full word.
* **Chat, Guessing, & Scoring Engine**:
  * Non-drawers submit guesses via keyboard (`Enter`) or Send button.
  * Input focus retention prevents keyboard blur during rapid successive guesses.
  * Levenshtein distance calculation detects close guesses and emits private hints (`"You're very close!"`).
  * Dynamic time-fraction scoring: 100–500 pts for guessers, 25% bonus for the drawer.
  * Early turn completion triggers automatically when all eligible guessers guess correctly.
* **Resilient Reconnection System**:
  * Unpredictable, cryptographically secure 128-bit `reconnectToken` stored in `sessionStorage`.
  * 15-second disconnection grace period prevents premature player removal on page refresh.
  * Atomic session takeover evicts superseded sockets, preventing ghost disconnect timers.
  * Automatic restoration of roles, score, canvas stroke history, secret words, and hints.
* **Hardened Security & Rate Limiting**:
  * Strict CORS whitelist and Socket.IO handshake origin validation rejecting unauthorized cross-site WebSockets.
  * Server-side sliding-window rate limiting for room creation (5/min) and drawing strokes (120/sec).
  * Timing-safe token comparison (`crypto.timingSafeEqual`) preventing side-channel attacks.
  * Zero secret word leakage in public state updates or chat notifications.

---

## 2. Architecture & Directory Structure

```
skribbl.io Clone/
├── client/                     # Frontend client (React + TypeScript + Vite)
│   ├── public/                 # Static public assets
│   ├── src/
│   │   ├── components/
│   │   │   ├── HomePage.tsx       # Landing screen: Nickname, Create Room, Join with code/URL
│   │   │   ├── Lobby.tsx          # Roster, host controls, slider settings, start validation
│   │   │   ├── DrawingCanvas.tsx  # HTML5 Canvas with normalized coords & high-DPI scaling
│   │   │   ├── DrawingToolbar.tsx # Color picker, size selector, eraser, undo, clear
│   │   │   ├── GamePage.tsx       # Game arena: player roster, banners, timer, overlays
│   │   │   └── ChatPanel.tsx      # Real-time chat & guessing with continuous keyboard focus
│   │   ├── types/
│   │   │   └── index.ts        # Client TypeScript interfaces (Stroke, RoomState, GamePhase)
│   │   ├── App.tsx             # State machine router, session resumption, connection status
│   │   ├── App.css             # Arena layout, responsive design, toolbar, status pills
│   │   ├── index.css           # Global CSS reset & typography
│   │   ├── main.tsx            # React root mount
│   │   └── socket.ts           # Socket.IO client singleton instance
│   ├── .env.example            # Client environment variable template
│   └── package.json            # Client dependencies & build scripts
│
├── server/                     # Backend server (Node.js + Express + TypeScript + Socket.IO)
│   ├── src/
│   │   ├── data/
│   │   │   └── words.json      # Categorized English dictionary (animals, objects, food, etc.)
│   │   ├── handlers/
│   │   │   ├── roomHandler.ts  # Room lifecycle, host settings, join/resume routing
│   │   │   ├── drawHandler.ts  # Canvas drawing synchronization & stroke rate limiting
│   │   │   └── chatHandler.ts  # Guess submission & chat history retrieval
│   │   ├── managers/
│   │   │   ├── RoomManager.ts  # Room registry, socket routing, atomic takeover, disconnects
│   │   │   └── WordManager.ts  # Dictionary lookups, random choices, selective letter masking
│   │   ├── models/
│   │   │   └── Room.ts         # Server-authoritative Game State Machine, hints, scoring, timers
│   │   ├── utils/
│   │   │   └── RateLimiter.ts  # Self-cleaning in-memory sliding-window rate limiter
│   │   ├── types/
│   │   │   └── index.ts        # Server TypeScript interfaces (InternalPlayer, Stroke, etc.)
│   │   └── index.ts            # Entry point, Express app, CORS security, graceful shutdown
│   ├── test/
│   │   └── regression.test.ts  # Comprehensive 49-point automated regression test suite
│   ├── .env.example            # Server environment variable template
│   └── package.json            # Server dependencies & test scripts
│
├── .gitignore                  # Git ignore rules for node_modules, dist, .env
├── package.json                # Monorepo root scripts (build, test, start)
├── PROJECT_AUDIT_REPORT.md     # Production readiness audit report (Pre & Post Phase 6)
└── README.md                   # Documentation and deployment guide
```

---

## 3. Prerequisites

* **Node.js**: v18.0.0 or higher (v20+ or v24+ recommended)
* **npm**: v9.0.0 or higher
* **Operating System**: Windows, macOS, or Linux

---

## 4. Installation & Setup

Clone the repository and install dependencies in both packages:

```bash
# 1. Install server dependencies
cd server
npm install

# 2. Install client dependencies
cd ../client
npm install

# 3. Return to root directory
cd ..
```

---

## 5. Environment Configuration

### Client (`client/.env`)
Copy `client/.env.example` to `client/.env`:

```env
# URL of the backend Socket.IO server
# Local development:
VITE_SERVER_URL=http://localhost:3001

# Production example:
# VITE_SERVER_URL=https://your-api.onrender.com
```

### Server (`server/.env`)
Copy `server/.env.example` to `server/.env`:

```env
# Port on which the HTTP/WebSocket server listens
PORT=3001

# Comma-separated list of allowed frontend origins for CORS and Socket.IO
# Local development:
CLIENT_URL=http://localhost:5173,http://127.0.0.1:5173

# Production example:
# CLIENT_URL=https://your-app.vercel.app,https://your-custom-domain.com
# NODE_ENV=production
```

---

## 6. Local Development Instructions

### Running with Windows PowerShell

Open two PowerShell windows:

**Terminal 1 — Backend Server:**
```powershell
cd "F:\AntiGravity\skribbl.io Clone\server"
npm.cmd run dev
```
*Server starts with hot-reloading at `http://localhost:3001`.*

**Terminal 2 — Frontend Client:**
```powershell
cd "F:\AntiGravity\skribbl.io Clone\client"
npm.cmd run dev
```
*Client starts with Vite at `http://localhost:5173`.*

---

## 7. Build & Automated Test Commands

### Run Complete Regression Suite (49 Automated Tests)
The regression suite exercises real WebSockets verifying room creation, capacity limits, CORS rejection, drawing sync, progressive letter hints, scoring, session takeover, and memory cleanup:

```powershell
# From root directory:
npm.cmd run test

# Or directly from server:
cd server
npm.cmd test
```

### Build for Production
```powershell
# Build both frontend and backend bundles from root:
npm.cmd run build

# Or build individually:
npm.cmd run build:client
npm.cmd run build:server
```

### Production Local Run
```powershell
npm.cmd run start
```

---

## 8. Manual Testing in Two Browser Tabs (Alice & Bob)

1. **Tab 1 (Host - Alice):**
   * Open `http://localhost:5173`.
   * Enter nickname `Alice` and click **✨ Create Room**.
   * Customize settings (e.g., Rounds: `2`, Draw Time: `30s`, Hints: `2`).
   * Click **🔗 Invite Link** (copies URL with `?room=CODE`).
2. **Tab 2 (Guest - Bob):**
   * Open a private/incognito window and paste the invite URL.
   * Room code automatically pre-fills. Enter nickname `Bob` and click **🚀 Join Room**.
   * Both tabs immediately show each other on the live lobby roster.
3. **Start Game & Word Selection:**
   * In Tab 1, Alice clicks **🚀 Start Game**.
   * Alice (Drawer) sees 3 word choices with a 10s selection countdown.
   * Bob sees: *"Alice is choosing a word to draw..."*.
4. **Drawing & Progressive Hints:**
   * Alice chooses a word (e.g. `APPLE`).
   * Alice sees `YOUR WORD: APPLE` and the canvas tools unlock.
   * Bob sees masked dashes `_ _ _ _ _` (5 letters).
   * As the timer counts down, progressive hints reveal letters at scheduled intervals (e.g., `_ _ _ _ E` ➔ `_ _ _ L E`).
5. **Real-time Guessing:**
   * Bob types guesses in the chat input. Incorrect guesses display as regular chat.
   * If Bob types a close word (e.g. `APLE`), Bob receives a private yellow hint: *"You're very close!"*.
   * When Bob types `APPLE`, the turn ends early: Bob earns points based on remaining time, and Alice earns a 25% drawer bonus.
6. **Session Reconnection (F5 Test):**
   * While drawing, press `F5` in Alice's tab.
   * Alice automatically reconnects, retains her drawer role and secret word, restores the canvas, and the timer continues without restarting.

---

## 9. Production Deployment Guide

The application supports two production deployment architectures:

### Architecture Option A: Split Deployment (Recommended for Scalability)
* **Frontend**: Deploy `client/` to [Vercel](https://vercel.com/) or [Netlify](https://www.netlify.com/).
  * Build Command: `npm run build`
  * Output Directory: `dist`
  * Environment Variable: `VITE_SERVER_URL=https://your-server.onrender.com`
* **Backend**: Deploy `server/` to [Render](https://render.com/) or [Railway](https://railway.app/).
  * Build Command: `npm run build`
  * Start Command: `npm run start`
  * Environment Variables:
    * `PORT=10000` (or assigned by provider)
    * `NODE_ENV=production`
    * `CLIENT_URL=https://your-frontend.vercel.app`

### Architecture Option B: Unified Single-Service Deployment
The backend Express server is configured to automatically serve the production Vite bundle from `client/dist` when `NODE_ENV === 'production'`:

* **Build Command**: `npm run build` *(builds both client and server)*
* **Start Command**: `npm start` *(starts Express server serving static assets and WebSockets)*
* **Environment Variables**:
  * `NODE_ENV=production`
  * `PORT=3001` (or assigned by provider)
  * `CLIENT_URL=https://your-app-domain.com`

### WebSocket Hosting Requirements
* **Sticky Sessions**: Socket.IO uses WebSocket transport with polling fallback. If deploying across multiple backend instances behind a load balancer, sticky sessions (session affinity) must be enabled.
* **Persistent Connections**: Free-tier cloud providers that sleep after inactivity (e.g. Render free tier) will drop active rooms and connections when sleeping. Paid or always-on instances are recommended for multiplayer games.

---

## 10. Security Considerations & Current Limitations

1. **In-Memory State**: Active rooms and player scores are stored in server memory for zero-latency performance. If the server process restarts, active rooms are reset. *(Documented constraint: no database requirement per project brief).*
2. **Single-Instance Rate Limiting**: The built-in rate limiters (room creation and stroke frequency) are in-memory. For clustered multi-node deployments, an external Redis adapter (`@socket.io/redis-adapter`) should be integrated.
3. **No Ambient Cookies**: The application uses cryptographically secure client-passed tokens for authentication, preventing Cross-Site Request Forgery (CSRF).

---

## 11. Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| `Cannot connect to server` | Backend is not running or port mismatch | Verify server is running on `http://localhost:3001` and `VITE_SERVER_URL` matches in `client/.env`. |
| `WebSocket connection failed: Origin not allowed` | Frontend origin is missing from backend whitelist | Add your frontend URL to `CLIENT_URL` in `server/.env`. |
| `Room code not found` | Server restarted or code mistyped | Codes are 6 uppercase letters/numbers. Rooms reset if server restarts. |
| `Execution policy error in PowerShell` | PowerShell script execution policy | Use `npm.cmd run <script>` instead of `npm run <script>`. |

---
*Developed as part of the Full Stack Development Technical Assignment.*
