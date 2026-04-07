let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

let chatMessages = [];
let isAiTyping = false;

const statusEl = document.getElementById('status');
const hotkeyLabelEl = document.getElementById('hotkeyLabel');
const transcriptEl = document.getElementById('transcript');
const recordBtn = document.getElementById('recordBtn');
const pasteBtn = document.getElementById('pasteBtn');
const dgBadgeEl = document.getElementById('dgBalance');
const gqBadgeEl = document.getElementById('gqBalance');
const balanceStatusEl = document.getElementById('balanceStatus');
const dgDotEl = document.getElementById('dgDot');
const gqDotEl = document.getElementById('gqDot');
const dgLabelEl = document.getElementById('dgLabel');
const gqLabelEl = document.getElementById('gqLabel');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInputEl = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicatorEl = document.getElementById('typingIndicator');
const clearChatBtn = document.getElementById('clearChatBtn');
const copyLastBtn = document.getElementById('copyLastBtn');

async function init() {
  const cfg = await window.vocalflow.getConfig();
  if (cfg && cfg.hotkey) {
    hotkeyLabelEl.textContent = `Global hotkey: ${cfg.hotkey}`;
  }

  window.vocalflow.onGlobalHotkey(() => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording(true);
    }
  });

  recordBtn.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording(false);
    }
  });

  pasteBtn.addEventListener('click', async () => {
    const text = transcriptEl.value || '';
    const res = await window.vocalflow.pasteText(text);
    if (!res.ok) {
      statusEl.textContent = `Paste failed: ${res.error}`;
    } else {
      statusEl.textContent = 'Pasted transcript at cursor.';
    }
  });

  sendBtn.addEventListener('click', () => {
    const text = (chatInputEl.value || '').trim();
    if (!text) return;
    chatInputEl.value = '';
    appendMessageAndSend(text, 'user');
  });

  chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  clearChatBtn.addEventListener('click', () => {
    chatMessages = [];
    saveChatHistory();
    renderChat();
    statusEl.textContent = 'Chat cleared.';
  });

  copyLastBtn.addEventListener('click', async () => {
    const lastAssistant = [...chatMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) {
      statusEl.textContent = 'No AI reply to copy yet.';
      return;
    }
    try {
      await navigator.clipboard.writeText(lastAssistant.content || '');
      statusEl.textContent = 'Last AI reply copied to clipboard.';
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Could not access clipboard to copy reply.';
    }
  });

  loadChatHistory();
  renderChat();

  refreshBalances();
}

async function refreshBalances() {
  balanceStatusEl.textContent = 'Fetching balances...';
  const [dg, gq] = await Promise.all([
    window.vocalflow.fetchDeepgramBalance(),
    window.vocalflow.fetchGroqBalance()
  ]);

  if (dg && dg.ok && dg.balance) {
    dgDotEl.className = 'status-dot ok';
    dgLabelEl.textContent = `Deepgram Balance: ${dg.balance.amount} ${dg.balance.units}`;
  } else if (dg && !dg.ok) {
    dgDotEl.className = 'status-dot warn';
    dgLabelEl.textContent = 'Deepgram: Available (demo)';
  }

  if (gq && gq.ok && gq.raw && gq.raw.data && gq.raw.data.result && gq.raw.data.result[0]) {
    const value = gq.raw.data.result[0].value?.[1] ?? '0';
    gqDotEl.className = 'status-dot ok';
    gqLabelEl.textContent = `Groq Usage: ${value} tokens/5m`;
  } else if (gq && !gq.ok) {
    gqDotEl.className = 'status-dot warn';
    gqLabelEl.textContent = 'Groq: Active (demo)';
  }

  balanceStatusEl.textContent = 'Balances refreshed from API (if configured).';
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      statusEl.textContent = 'Transcribing with Deepgram...';
      const res = await window.vocalflow.transcribeAudio(buffer);
      if (!res.ok) {
        statusEl.textContent = `Transcription failed: ${res.error}`;
        return;
      }

      let text = res.transcript || '';
      transcriptEl.value = text;
  statusEl.textContent = 'Transcript received. Enhancing with Groq (if configured)...';

      const groqRes = await window.vocalflow.processWithGroq(text, {
        fixSpelling: true,
        fixGrammar: true
      });

      if (groqRes && groqRes.ok) {
        transcriptEl.value = groqRes.processed;
        if (groqRes.demo) {
          statusEl.textContent = 'Groq not configured – using original transcript. Sending to AI chat...';
        } else {
          statusEl.textContent = 'Transcript refined with Groq. Sending to AI chat...';
        }
        await appendMessageAndSend(groqRes.processed, 'user');
      } else if (groqRes && !groqRes.ok) {
        statusEl.textContent = 'Groq enhancement unavailable – sending raw transcript to chat...';
        await appendMessageAndSend(text, 'user');
      } else {
        statusEl.textContent = 'Transcript ready. Sending to AI chat...';
        await appendMessageAndSend(text, 'user');
      }
    };

    mediaRecorder.start();
    isRecording = true;
    recordBtn.textContent = 'Stop Recording';
    recordBtn.classList.add('recording');
    statusEl.textContent = 'Listening... speak now.';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Microphone access failed. Check permissions.';
  }
}

function stopRecording(triggerPaste) {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  isRecording = false;
  recordBtn.textContent = 'Start Recording';
  recordBtn.classList.remove('recording');

  if (triggerPaste) {
    // After transcription completes, user can hit paste manually
    statusEl.textContent = 'Stopped recording. Transcribing with Deepgram...';
  }
}

function loadChatHistory() {
  try {
    const raw = window.localStorage.getItem('vocalflow-chat');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      chatMessages = parsed;
    }
  } catch (err) {
    console.error('Failed to load chat history', err);
  }
}

function saveChatHistory() {
  try {
    window.localStorage.setItem('vocalflow-chat', JSON.stringify(chatMessages));
  } catch (err) {
    console.error('Failed to save chat history', err);
  }
}

function renderChat() {
  chatMessagesEl.innerHTML = '';
  for (const msg of chatMessages) {
    const div = document.createElement('div');
    div.className = `bubble ${msg.role === 'user' ? 'user' : 'assistant'}`;
    div.textContent = msg.content;
    chatMessagesEl.appendChild(div);
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  typingIndicatorEl.style.display = isAiTyping ? 'block' : 'none';
}

async function appendMessageAndSend(text, role) {
  chatMessages.push({ role, content: text });
  saveChatHistory();
  renderChat();

  if (role !== 'user') return;

  isAiTyping = true;
  renderChat();
  statusEl.textContent = 'Generating AI response...';

  const openAiMessages = [
    {
      role: 'system',
      content:
        'You are a smart voice assistant called VocalFlow. Respond concisely, clearly, and helpfully. If the user input is messy or spoken, first normalise grammar and punctuation, then answer with a clean, well-structured reply. Prefer short paragraphs and bullet lists over long walls of text.'
    },
    ...chatMessages.map((m) => ({ role: m.role, content: m.content }))
  ];

  try {
    const res = await window.vocalflow.chatWithGroq(openAiMessages);
    if (res && res.ok && res.reply) {
      chatMessages.push({ role: 'assistant', content: res.reply });
      saveChatHistory();
      if (res.demo) {
        statusEl.textContent = 'Groq not configured – running in demo mode.';
      } else {
        statusEl.textContent = 'AI reply received.';
      }
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'AI is currently unavailable; showing your input as-is.';
  } finally {
    isAiTyping = false;
    renderChat();
  }
}

window.addEventListener('DOMContentLoaded', init);
