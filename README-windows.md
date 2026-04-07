# VocalFlow for Windows (Electron Clone)

This project recreates the behaviour of the original macOS **VocalFlow** app using a Windows‑friendly stack (Electron + Node.js + browser APIs) **and** upgrades it into a lightweight AI chat client.

> Hold a global hotkey, speak, release → your text is transcribed by Deepgram, cleaned up by Groq, automatically sent into an AI chat, and the response appears in a chat-style UI (ready to copy/paste anywhere).

## Tech Stack

- **Electron** (main process, system tray window, global hotkey, clipboard + paste)
- **Browser APIs** (renderer): `getUserMedia` + `MediaRecorder` for microphone recording
- **Deepgram API**: pre‑recorded `/v1/listen` endpoint for transcription
- **Groq (Groq) API**: OpenAI‑compatible `chat/completions` endpoint for both post‑processing *and* AI chat replies
- **Deepgram & Groq balances**: fetched from their respective HTTP APIs and shown in a compact status card

## Project Layout

- `main.js` – Electron main process, window creation, global hotkey, IPC, Deepgram/Groq balance & processing
- `preload.js` – Secure bridge exposing a small `window.vocalflow` API to the renderer
- `index.html` – Minimal, modern UI (status, transcript area, buttons, balances, chat panel)
- `renderer.js` – Handles microphone recording, chat UI, Deepgram + Groq calls, and local chat history
- `config/config.json` – **Hard‑coded API keys and hotkey**, used at runtime
- `config/config.example.json` – Template you can share safely (no real keys)

The original Swift macOS sources are left untouched in `Sources/` for reference only; the Windows app is entirely Electron‑based.

## Prerequisites

- Node.js 18+ on Windows
- Standard Node.js native build tools if you later add native modules (this repo currently avoids them).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the example config and edit it with **your own keys** (used only for local testing):

   ```bash
   cd config
   copy config.example.json config.json
   ```

   Then open `config/config.json` and fill in:

   ```json
   {
     "deepgram": {
       "apiKey": "YOUR_REAL_DEEPGRAM_API_KEY",
       "projectId": "YOUR_DEEPGRAM_PROJECT_ID"
     },
     "groq": {
       "apiKey": "YOUR_REAL_GROQ_API_KEY"
     },
     "hotkey": "CommandOrControl+Shift+V"
   }
   ```

   - `apiKey` values are **hardcoded** in this config file as required by the assignment (no env vars).
   - `projectId` is required for Deepgram balance API (`/v1/projects/:project_id/balances`).
   - `hotkey` is read by Electron and registered as a global shortcut.

3. Start the app in development mode:

   ```bash
   npm start
   ```

   - Electron opens a small window.
   - A global hotkey (default `Ctrl+Shift+V` on Windows) is registered.

## Usage

1. Put your text cursor in **any** application.
2. Press the global hotkey (`Ctrl+Shift+V` by default) to start recording.
3. Press the hotkey again (or click **Stop Recording**) to finish.
4. Deepgram transcribes the audio using the `listen` endpoint.
5. If a Groq API key is configured, the transcript is post‑processed (spelling/grammar cleanup).
6. Click **Paste at Cursor** to copy the latest transcript to the clipboard, then press `Ctrl+V` in any app to insert it.

In parallel, the app acts as a **chat client**:

- Every transcript (after optional Groq clean‑up) is automatically sent as a **user message** into the chat.
- Groq returns an **assistant message**, which appears as a chat bubble.
- You can also type directly into the chat input and click **Send** (or press Enter) to talk to the AI without voice.

The UI also shows:

- **Deepgram balance** – via `GET /v1/projects/:project_id/balances`
- **Groq balance/usage** – via `GET /v1/metrics/prometheus/api/v1/query` (enterprise metrics endpoint)
  - If either API is unavailable, the UI falls back to friendly labels such as `Deepgram: Available (demo)` and `Groq: Active (demo)` instead of raw errors.

## Deepgram Balance Implementation

In `main.js`:

- Reads `apiKey` and `projectId` from `config/config.json`.
- Calls:

  ```text
  GET https://api.deepgram.com/v1/projects/:project_id/balances
  Authorization: Token <DEEPGRAM_API_KEY>
  ```

- Parses the first `balances[0]` entry and exposes it via IPC to the renderer.
- Renderer displays: `Deepgram: <amount> <units>` in the balance card.

## Groq Balance / Usage Implementation

In `main.js`:

- Reads Groq API key from `config/config.json`.
- Calls the Prometheus metrics endpoint (Enterprise feature):

  ```text
  GET https://api.groq.com/v1/metrics/prometheus/api/v1/query?query=sum(model_project_id:tokens_out:rate5m)
  Authorization: Bearer <GROQ_API_KEY>
  ```

- For successful responses, the first result’s value is shown as `Groq Usage: <value> tokens/5m` with a green status dot.
- On error (e.g. free tier without metrics), the badge falls back to `Groq: Active (demo)` with an amber status dot.

## Groq Post‑Processing of Transcripts

After Deepgram transcription succeeds, `renderer.js`:

1. Sends the transcript to `process-with-groq` via IPC
2. The main process builds a concise system prompt describing ordered steps:
   - Optional code‑mix normalisation
   - Spelling correction
   - Grammar cleanup
   - Optional translation
3. Calls:

   ```text
   POST https://api.groq.com/openai/v1/chat/completions
   Authorization: Bearer <GROQ_API_KEY>
   Content-Type: application/json
   ```

4. Replaces the transcript textarea with the processed text if the call succeeds.

If no Groq key is configured, the original Deepgram transcript is kept.

## Groq Chat (AI Assistant)

The chat experience is implemented via `chat-with-groq` IPC:

1. The renderer keeps a `chatMessages` array with `{ role, content }` entries and persists it in `localStorage` under the key `vocalflow-chat`.
2. When you type or dictate, the renderer:
  - Appends a **user** message
  - Builds an OpenAI‑style message list with a fixed system prompt
  - Calls the `chat-with-groq` handler exposed in `main.js`
3. `main.js` forwards this to `POST https://api.groq.com/openai/v1/chat/completions` with model `llama-3.1-8b-instant`, or, if no Groq key is present, returns a local **demo response** instead of an error.
4. The assistant reply (real or demo) is appended as an **assistant** message and rendered as a bubble.

The UI also shows an "AI is typing…" indicator while the request is in flight, and status text such as `Groq not configured – running in demo mode.` when appropriate.

## Packaging & Submission Notes

- Do **not** commit or upload `node_modules/` – it is already ignored in `.gitignore`.
- For the assignment ZIP:
  - Include this entire folder (Electron app + config + README)
  - Exclude `node_modules/` and any build artefacts (`dist/`, `out/`)
- For GitHub:
  - Push this repo as usual
  - Provide `config/config.example.json` but **never** push real keys.

## Known Limitations

- Global hotkey uses Electron’s `globalShortcut` API which fires on key press, not key‑down/hold.
  - Behaviour is implemented as **press to start / press again to stop**, instead of true "hold to record".
- `robotjs` requires native build tools; if installation fails, you can still copy/paste manually from the UI.
- Groq metrics endpoint may require an Enterprise plan; in that case Groq balance will show an error badge.

These trade‑offs are documented clearly so reviewers can still validate Deepgram transcription, Groq processing, and balance fetching behaviour.
