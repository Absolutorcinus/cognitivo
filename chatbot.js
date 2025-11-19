const OPENAI_API_KEY = 'YOUR_OPENAI_API_KEY';
const KNOWLEDGE_BASE_PATH = 'knowledge-base/cognitivis.txt';
const chatbotName = 'Jisam';
let knowledgeChunks = [];

async function loadKnowledgeBase() {
  try {
    const response = await fetch(KNOWLEDGE_BASE_PATH);
    if (!response.ok) {
      throw new Error('Unable to load knowledge base');
    }
    const text = await response.text();
    knowledgeChunks = text
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  } catch (error) {
    console.error(error);
    knowledgeChunks = [];
  }
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function rankChunks(question, topK = 2) {
  if (!knowledgeChunks.length) {
    return [];
  }
  const questionTokens = tokenize(question);
  const scores = knowledgeChunks.map((chunk, index) => {
    const chunkTokens = tokenize(chunk);
    const overlap = chunkTokens.filter((token) => questionTokens.includes(token));
    return { chunk, score: overlap.length, index };
  });
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk }) => chunk);
}

function buildPrompt(context, question) {
  return [
    {
      role: 'system',
      content: `${chatbotName} is a knowledgeable Cognitivis guide. Answer in three concise paragraphs at most.`,
    },
    {
      role: 'user',
      content: `Use the following context from the Cognitivis knowledge base to answer the question.\nContext:\n${context}\n\nQuestion: ${question}`,
    },
  ];
}

function createMessageElement(text, sender) {
  const wrapper = document.createElement('div');
  wrapper.className = `chatbot__message chatbot__message--${sender}`;
  const bubble = document.createElement('div');
  bubble.className = 'chatbot__bubble';
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  return wrapper;
}

function appendMessage(container, text, sender) {
  const element = createMessageElement(text, sender);
  container.appendChild(element);
  container.scrollTop = container.scrollHeight;
  return element;
}

function fallbackAnswer(context, question) {
  return `I can help with Cognitivis questions using the on-page knowledge base. Please set your OpenAI API key in chatbot.js so I can craft richer answers.\n\nMost relevant context:\n${context}\n\nYour question: ${question}`;
}

async function askJisam(question, container) {
  const trimmed = question.trim();
  if (!trimmed) {
    return;
  }

  const loadingMessage = appendMessage(container, 'Thinking...', 'jisam');
  const ranked = rankChunks(trimmed);
  const context = ranked.join('\n\n');

  if (!OPENAI_API_KEY || OPENAI_API_KEY === 'YOUR_OPENAI_API_KEY') {
    loadingMessage.replaceWith(
      createMessageElement(fallbackAnswer(context || 'Knowledge base unavailable.', trimmed), 'jisam')
    );
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: buildPrompt(context, trimmed),
      }),
    });

    if (!response.ok) {
      throw new Error('Request failed');
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (answer) {
      loadingMessage.replaceWith(createMessageElement(answer, 'jisam'));
    } else {
      loadingMessage.replaceWith(createMessageElement('I could not find an answer right now.', 'jisam'));
    }
  } catch (error) {
    console.error(error);
    loadingMessage.replaceWith(
      createMessageElement('Something went wrong reaching OpenAI. Please try again in a moment.', 'jisam')
    );
  }
}

function initChatbot() {
  const chatContainer = document.querySelector('.chatbot__messages');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  const widget = document.querySelector('.chatbot-widget');
  const launcher = document.getElementById('chatbot-launcher');
  const minimizeButton = document.getElementById('chatbot-minimize');
  const panel = document.getElementById('chatbot-panel');
  if (!chatContainer || !form || !input || !widget || !launcher || !minimizeButton || !panel) {
    return;
  }

  const setCollapsed = (collapsed) => {
    widget.classList.toggle('chatbot-widget--collapsed', collapsed);
    widget.classList.toggle('chatbot-widget--open', !collapsed);
    launcher.setAttribute('aria-expanded', (!collapsed).toString());
    panel.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (!collapsed) {
      input.focus();
    }
  };

  appendMessage(chatContainer, `Hi, I'm ${chatbotName}. Ask me anything about Cognitivis and I'll answer using our knowledge base.`, 'jisam');
  loadKnowledgeBase();
  setCollapsed(false);

  launcher.addEventListener('click', () => setCollapsed(false));
  minimizeButton.addEventListener('click', () => setCollapsed(true));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value;
    if (!question.trim()) {
      return;
    }
    appendMessage(chatContainer, question, 'user');
    input.value = '';
    askJisam(question, chatContainer);
  });
}

document.addEventListener('DOMContentLoaded', initChatbot);
