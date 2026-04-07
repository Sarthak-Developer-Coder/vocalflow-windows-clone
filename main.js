const { app, BrowserWindow, globalShortcut, ipcMain, clipboard } = require('electron');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const config = require('./config/config.json');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  const hotkey = (config.hotkey || 'CommandOrControl+Shift+V');
  const registered = globalShortcut.register(hotkey, () => {
    if (mainWindow) {
      mainWindow.webContents.send('global-hotkey');
    }
  });

  if (!registered) {
    console.error('Failed to register global hotkey');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('get-config', async () => {
  return {
    deepgramHasKey: !!config.deepgram.apiKey && config.deepgram.apiKey !== 'YOUR_DEEPGRAM_API_KEY',
    groqHasKey: !!config.groq.apiKey && config.groq.apiKey !== 'YOUR_GROQ_API_KEY',
    hotkey: config.hotkey
  };
});

ipcMain.handle('paste-text', async (_event, text) => {
  try {
    clipboard.writeText(text || '');
    // We no longer simulate Ctrl+V via a native module to avoid
    // build issues; users can press Ctrl+V manually after this.
    return { ok: true, note: 'Text copied to clipboard; press Ctrl+V to paste.' };
  } catch (err) {
    console.error('Failed to paste text', err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('fetch-deepgram-balance', async () => {
  const apiKey = config.deepgram.apiKey;
  const projectId = config.deepgram.projectId;
  if (!apiKey || !projectId || apiKey === 'YOUR_DEEPGRAM_API_KEY') {
    return { ok: false, error: 'Deepgram API key or projectId not configured' };
  }

  try {
    const url = `https://api.deepgram.com/v1/projects/${projectId}/balances`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const balance = (data.balances && data.balances[0]) || null;
    return { ok: true, raw: data, balance };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('fetch-groq-balance', async () => {
  const apiKey = config.groq.apiKey;
  if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') {
    return { ok: false, error: 'Groq API key not configured' };
  }

  try {
    // Uses Prometheus metrics endpoint to approximate usage; may require Enterprise tier
    const query = encodeURIComponent('sum(model_project_id:tokens_out:rate5m)');
    const url = `https://api.groq.com/v1/metrics/prometheus/api/v1/query?query=${query}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, raw: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('transcribe-audio', async (_event, audioBuffer) => {
  const apiKey = config.deepgram.apiKey;
  if (!apiKey || apiKey === 'YOUR_DEEPGRAM_API_KEY') {
    return { ok: false, error: 'Deepgram API key not configured' };
  }

  try {
    const url = 'https://api.deepgram.com/v1/listen?model=nova-3&language=en';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'audio/webm'
      },
      body: Buffer.from(audioBuffer)
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    return { ok: true, transcript, raw: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('process-with-groq', async (_event, originalText, options) => {
  const apiKey = config.groq.apiKey;
  if (!originalText) {
    return { ok: true, processed: originalText };
  }

  // If Groq key is missing, run in graceful demo mode –
  // we simply return the original text but mark it as demo.
  if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') {
    return {
      ok: true,
      processed: originalText,
      demo: true,
      note: 'Groq not configured – running without enhancement.'
    };
  }

  const { codeMixStyle, fixSpelling, fixGrammar, targetLanguage } = options || {};
  const steps = [];

  if (codeMixStyle) {
    steps.push(`1. Treat the input as ${codeMixStyle} code-mixed text and normalise scripts while preserving meaning.`);
  }
  if (fixSpelling) {
    steps.push('2. Correct spelling mistakes without changing meaning.');
  }
  if (fixGrammar) {
    steps.push('3. Improve grammar without adding or removing information.');
  }
  if (targetLanguage) {
    steps.push(`4. If a target language is provided (${targetLanguage}), translate the final text into that language.`);
  }

  if (!steps.length) {
    return { ok: true, processed: originalText };
  }

  const systemPrompt = 'You are a text post-processor. Apply the following steps in order and respond with only the final text, no explanation:\n' + steps.join('\n');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: originalText }
        ],
        temperature: 0
      })
    });

    if (!res.ok) {
      return {
        ok: true,
        processed: originalText,
        demo: true,
        note: `Groq enhancement unavailable (HTTP ${res.status}).` 
      };
    }

    const data = await res.json();
    const processed = data.choices?.[0]?.message?.content || originalText;
    return { ok: true, processed, raw: data };
  } catch (err) {
    return {
      ok: true,
      processed: originalText,
      demo: true,
      note: `Groq enhancement failed – running original text. (${String(err)})`
    };
  }
});

// Full chat-style Groq integration: takes an array of OpenAI-style
// messages (role/content) from the renderer and returns a reply.
ipcMain.handle('chat-with-groq', async (_event, messages) => {
  const apiKey = config.groq.apiKey;

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'No messages to send' };
  }

  // Demo mode: if no Groq key, return a simulated assistant message
  if (!apiKey || apiKey === 'YOUR_GROQ_API_KEY') {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const echoContent = lastUser?.content || 'your request';
    const reply = `Demo mode – Groq key not configured.

Here is a cleaned-up version of what you said:

${echoContent}`;
    return { ok: true, reply, demo: true, note: 'Groq not configured – using local demo response.' };
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages,
        temperature: 0.4
      })
    });

    if (!res.ok) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const echoContent = lastUser?.content || 'your request';
      const reply = `AI is currently unavailable (HTTP ${res.status}).

Here is your input, kept safe:

${echoContent}`;
      return { ok: true, reply, demo: true, note: 'Groq call failed – returning safe fallback.' };
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';
    return { ok: true, reply, raw: data };
  } catch (err) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const echoContent = lastUser?.content || 'your request';
    const reply = `AI is currently unavailable.

Here is your input, kept as-is:

${echoContent}`;
    return { ok: true, reply, demo: true, note: `Groq call crashed – ${String(err)}` };
  }
});
