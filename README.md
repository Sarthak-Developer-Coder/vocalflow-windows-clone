# VocalFlow for Windows (Electron Clone)
A production-ready Windows clone of VocalFlow built with Electron, featuring real-time voice transcription, AI-powered chat, and a robust demo-safe architecture.
This repository is a **Windows-focused clone and upgrade** of the original macOS [VocalFlow](https://github.com/Vocallabsai/vocalflow) app.

Instead of a macOS menu bar app in Swift, this project uses **Electron + Node.js** to deliver a Windows-friendly experience:

> Hold a global hotkey, speak, release → your speech is transcribed by **Deepgram**, optionally cleaned up and answered by **Groq**, rendered in a **chat UI**, and ready to paste anywhere.

It is designed to be easy to run for reviewers and to demonstrate strong product thinking, not just raw coding.

---

## Demo Flow (What to Try First)

1. **Start the app**
   - From the project root:

     ```bash
     npm install
     npm start
     ```

   - An Electron window titled *VocalFlow for Windows* opens.

2. **Dictate with the global hotkey**
   - Put your text cursor in any Windows app (Notepad, VS Code, browser, etc.).
   - Press `Ctrl+Shift+V` to start recording.
   - Speak a short sentence.
   - Press `Ctrl+Shift+V` again to stop.

3. **Watch the status strip narrate the pipeline**
   - `Listening... speak now.`
   - `Stopped recording. Transcribing with Deepgram...`
   - `Transcript received. Enhancing with Groq (if configured)...`
   - `Generating AI response...`

4. **See voice → AI chat in action**
   - Your spoken text appears in **Live Transcript**.
   - The cleaned-up text is sent as a **user message** into the chat.
   - Groq returns an **assistant reply**, which appears as a chat bubble.
   - If Groq is not configured, the app runs in **demo mode** and still returns a friendly, local response.

5. **Paste the result anywhere**
   - Click **Paste at Cursor** to copy the transcript to the clipboard.
   - Press `Ctrl+V` in your target app.

6. **Use chat controls**
   - Type directly in the chat input and hit **Send** for text-only conversations.
   - Click **Copy last reply** to put the latest AI answer on your clipboard.
   - Click **Clear chat** to reset the conversation (history is stored in `localStorage`).

---

## Features

- **Global hotkey dictation** – `Ctrl+Shift+V` starts/stops recording from anywhere.
- **Deepgram transcription** – uses the `/v1/listen` API to turn audio into text.
- **Groq-powered AI assistant**
  - Optional transcript clean-up (spelling, grammar, structure).
  - Full chat-style responses via the OpenAI-compatible `chat/completions` API.
  - Strong **system prompt** tuned for voice input and concise, helpful answers.
- **Chat UI**
  - Left/right bubbles for assistant/user messages.
  - "AI is typing…" indicator while the reply is generated.
  - Persistent history via `localStorage` (restored on reload).
- **Balances dashboard**
  - Deepgram project balance via `GET /v1/projects/:project_id/balances`.
  - Groq usage via Prometheus metrics (`/v1/metrics/prometheus/...`).
  - Premium-looking badges with coloured status dots (`🟢 active`, `🟡 demo`).
- **Safe demo mode**
  - If Groq keys or metrics are missing, the app never looks “broken”.
  - Chat still responds with local, clearly-labelled demo messages.

---

## Tech Stack

- **Electron** – app shell, window, global shortcut, clipboard access.
- **Node.js** – Deepgram and Groq HTTP calls, IPC handlers.
- **Browser APIs** – `getUserMedia` + `MediaRecorder` for microphone capture.
- **Deepgram API** – transcription (`/v1/listen`) and balances (`/v1/projects/:project_id/balances`).
- **Groq API** – OpenAI-compatible `chat/completions` for post-processing + chat; Prometheus metrics API for usage.

The original macOS Swift sources remain under `Sources/` for reference only; the Windows experience is entirely powered by Electron.

---

## Project Structure

Key files:

- `main.js` – Electron main process
  - Creates the window
  - Registers the global hotkey
  - Handles IPC:
    - `transcribe-audio` → Deepgram `/v1/listen`
    - `process-with-groq` → optional text clean-up (with graceful demo mode)
    - `chat-with-groq` → full AI chat responses (with demo fallback)
    - `fetch-deepgram-balance` / `fetch-groq-balance` → balance badges
- `preload.js` – safe bridge that exposes a small `window.vocalflow` API.
- `renderer.js` – front-end logic
  - Microphone recording using `MediaRecorder`
  - Status text for each pipeline phase
  - Chat state, rendering, history persistence, copy/clear actions
- `index.html` – modern dark UI with status, transcript, balances, and chat.
- `config/config.json` – **runtime config with hard-coded keys** (not committed).
- `config/config.example.json` – safe template checked into git for reviewers.

---

## Setup (for Reviewers)

1. **Clone the repo**

   ```bash
   git clone https://github.com/Sarthak-Developer-Coder/vocalflow-windows-clone.git
   cd vocalflow-windows-clone
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure API keys (local only)**

   - Copy the example config:

     ```bash
     cd config
     copy config.example.json config.json   # on Windows
     ```

   - Edit `config/config.json` and fill in your own keys:

     ```json
     {
       "deepgram": {
         "apiKey": "YOUR_DEEPGRAM_API_KEY",
         "projectId": "YOUR_DEEPGRAM_PROJECT_ID"
       },
       "groq": {
         "apiKey": "YOUR_GROQ_API_KEY"
       },
       "hotkey": "CommandOrControl+Shift+V"
     }
     ```

   - These keys are deliberately **hard-coded in a config file** (per assignment instructions) but excluded from git via `.gitignore`.

4. **Run the app**

   ```bash
   npm start
   ```

---

## Deepgram & Groq Integration Details

### Transcription

- The renderer records audio as `audio/webm` using `MediaRecorder`.
- The main process sends it to Deepgram:

  ```text
  POST https://api.deepgram.com/v1/listen?model=nova-3&language=en
  Authorization: Token <DEEPGRAM_API_KEY>
  Content-Type: audio/webm
  ```

- The first transcript alternative is surfaced in the UI and then passed on to Groq.

### Groq Post-Processing

- `process-with-groq` builds a compact instruction list:
  - Normalise code-mixed text (optional).
  - Fix spelling and grammar.
  - Optionally translate.
- It then calls:

  ```text
  POST https://api.groq.com/openai/v1/chat/completions
  Authorization: Bearer <GROQ_API_KEY>
  Content-Type: application/json
  ```

- If Groq is not configured or fails, the app:
  - Returns the original transcript unchanged
  - Marks the result as demo (`demo: true`) and updates the status line accordingly.

### Groq Chat

- Chat messages are stored as `{ role, content }` pairs.
- For each user message (typed or dictated), the renderer sends:

  - A **system prompt** describing VocalFlow as a smart, concise voice assistant.
  - Full history of user + assistant messages.

- The main process either:
  - Calls Groq `chat/completions` and returns the real reply, or
  - If no key / error: synthesises a local, clearly-labelled demo reply that never breaks the UI.

---

## Balances & Status Badges

- **Deepgram** – project balances:

  ```text
  GET https://api.deepgram.com/v1/projects/:project_id/balances
  Authorization: Token <DEEPGRAM_API_KEY>
  ```

  - Success → `Deepgram Balance: <amount> <units>` with a green dot.
  - Failure / missing config → `Deepgram: Available (demo)` with an amber dot.

- **Groq** – usage metrics (Enterprise feature):

  ```text
  GET https://api.groq.com/v1/metrics/prometheus/api/v1/query?query=sum(model_project_id:tokens_out:rate5m)
  Authorization: Bearer <GROQ_API_KEY>
  ```

  - Success → `Groq Usage: <value> tokens/5m` with a green dot.
  - Failure / missing config → `Groq: Active (demo)` with an amber dot.

This keeps the UI **reassuring and production-like**, even when certain APIs are unavailable.

---

## Packaging & Submission Notes

- `node_modules/`, build output (`dist/`, `out/`), and the real `config/config.json` are excluded via `.gitignore`.
- For assignment submission:
  - **GitHub link**: `https://github.com/Sarthak-Developer-Coder/vocalflow-windows-clone`
  - **ZIP**: Archive the repo folder **without** `node_modules/`, but *with* your local `config/config.json` so reviewers can run it immediately.

---

## Limitations & Future Ideas

- Global hotkey is **press-to-toggle**, not hold-to-record (Electron constraint).
- If Groq metrics are not available, Groq usage falls back to demo labels.
- Future improvements could include:
  - Multi-language support and model selection from the UI.
  - Per-conversation system prompts or “tone” presets.
  - Packaging as a Windows installer via `electron-builder`.

---

## Credits

- Original concept and macOS implementation: [Vocallabsai/vocalflow](https://github.com/Vocallabsai/vocalflow).
- This Windows Electron clone, chat experience, and documentation were implemented as part of a take-home assignment to demonstrate **engineering quality, UX polish, and product thinking**.
