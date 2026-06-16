import { decryptAESGCMPBKDF } from '../shared/ld-crypto.js';
import QRCode from './qrcode.min.js';

const template = document.createElement('template');

async function loadStyles(serverUrl) {
  // Load CSS from the quiz server if specified, otherwise from the script's base URL
  const cssUrl = serverUrl 
    ? new URL('/client/quiz-styles.css', serverUrl) 
    : new URL('./quiz-styles.css', import.meta.url);
  const response = await fetch(cssUrl);
  const css = await response.text();
  return css;
}

async function loadKatexCSS(serverUrl) {
  const cssUrl = serverUrl 
    ? new URL('/katex/katex.min.css', serverUrl) 
    : new URL('/katex/katex.min.css', window.location.origin);
  const response = await fetch(cssUrl);
  const css = await response.text();
  return css;
}

class QuizHost extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.quiz = null;
    this.ws = null;
    this.roomId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.currentState = 'login';
    this.timerInterval = null;
    this.serverUrl = '';
  }

  async connectedCallback() {
    const encryptedQuiz = this.getAttribute('encrypted-quiz');
    const quizAttr = this.getAttribute('quiz');
    const isEncrypted = this.hasAttribute('encrypted');
    this.serverUrl = this.getAttribute('server-url') || window.location.origin;

    const [css, katexCss] = await Promise.all([
      loadStyles(this.serverUrl),
      loadKatexCSS(this.serverUrl)
    ]);
    template.innerHTML = `<style>${css}</style><style>${katexCss}</style><div class="quiz-container"><div id="content"></div></div>`;
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.contentEl = this.shadowRoot.getElementById('content');

    if (isEncrypted) {
      // Encrypted quiz: password login
      if (!encryptedQuiz) {
        this.showError('No encrypted quiz provided');
        return;
      }
      this.encryptedQuiz = encryptedQuiz;
      this.renderLogin();
    } else if (quizAttr) {
      // Unencrypted inline quiz
      try {
        this.quiz = JSON.parse(quizAttr);
        this.presenterToken = await this.hashQuiz(this.quiz);
        this.renderQuizPreview();
      } catch (e) {
        this.showError('Invalid quiz JSON');
      }
    } else {
      // Unencrypted file upload
      this.renderFileUpload();
    }
  }

  disconnectedCallback() {
    if (this.ws) {
      this.ws.close();
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  renderLogin() {
    this.currentState = 'login';
    this.contentEl.innerHTML = `
      <h2 class="quiz-title">Quiz Login</h2>
      <form class="quiz-form" id="login-form">
        <input type="password" class="quiz-input" id="password" placeholder="Enter your password" autocomplete="off">
        <button type="submit" class="quiz-btn quiz-btn-primary">Start Quiz</button>
      </form>
      <div id="error" class="quiz-error" style="display:none"></div>
    `;

    const form = this.shadowRoot.getElementById('login-form');
    const passwordInput = this.shadowRoot.getElementById('password');
    const errorEl = this.shadowRoot.getElementById('error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = passwordInput.value;
      if (!password) return;

      errorEl.style.display = 'none';
      passwordInput.disabled = true;
      form.querySelector('button').textContent = 'Decrypting...';

      try {
        const decrypted = await decryptAESGCMPBKDF(this.encryptedQuiz, password);
        this.quiz = JSON.parse(decrypted);
        this.password = password;
        this.presenterToken = await this.hashPassword(password);
        this.connectWebSocket();
      } catch (err) {
        errorEl.textContent = 'Invalid password or corrupted quiz data';
        errorEl.style.display = 'block';
        passwordInput.disabled = false;
        form.querySelector('button').textContent = 'Start Quiz';
      }
    });
  }

  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async hashQuiz(quiz) {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(quiz));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  renderQuizPreview() {
    this.currentState = 'preview';
    this.contentEl.innerHTML = `
      <div class="quiz-preview">
        <h2 class="quiz-title">${this.escapeHtml(this.quiz.title || 'Quiz')}</h2>
        <div class="quiz-meta">${this.quiz.questions.length} questions</div>
        <button class="quiz-btn quiz-btn-primary" id="btn-start">Start Quiz</button>
      </div>
    `;

    const btnStart = this.shadowRoot.getElementById('btn-start');
    btnStart.addEventListener('click', () => {
      this.connectWebSocket();
    });
  }

  renderFileUpload() {
    this.currentState = 'upload';
    this.contentEl.innerHTML = `
      <div class="quiz-upload">
        <h2 class="quiz-title">Upload Quiz</h2>
        <p class="quiz-info">Select a JSON quiz file to upload</p>
        <label class="quiz-file-label">
          <input type="file" class="quiz-file-input" id="quiz-file" accept=".json">
          <span class="quiz-file-btn">Choose File</span>
        </label>
        <div id="quiz-file-name" class="quiz-file-name"></div>
        <div id="quiz-preview" class="quiz-preview-container" style="display:none"></div>
        <div id="error" class="quiz-error" style="display:none"></div>
      </div>
    `;

    const fileInput = this.shadowRoot.getElementById('quiz-file');
    const fileName = this.shadowRoot.getElementById('quiz-file-name');
    const previewContainer = this.shadowRoot.getElementById('quiz-preview');
    const errorEl = this.shadowRoot.getElementById('error');

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      errorEl.style.display = 'none';
      fileName.textContent = file.name;

      try {
        const text = await file.text();
        const quiz = JSON.parse(text);
        this.quiz = quiz;
        this.presenterToken = await this.hashQuiz(quiz);

        // Show preview
        previewContainer.style.display = 'block';
        previewContainer.innerHTML = `
          <h3 class="quiz-title">${this.escapeHtml(quiz.title || 'Quiz')}</h3>
          <div class="quiz-meta">${quiz.questions.length} questions</div>
          <button class="quiz-btn quiz-btn-primary" id="btn-start-upload">Start Quiz</button>
        `;

        const btnStart = this.shadowRoot.getElementById('btn-start-upload');
        btnStart.addEventListener('click', () => {
          this.connectWebSocket();
        });
      } catch (err) {
        errorEl.textContent = 'Invalid JSON file';
        errorEl.style.display = 'block';
        previewContainer.style.display = 'none';
      }
    });
  }

  connectWebSocket() {
    const wsUrl = this.serverUrl.replace(/^http/, 'ws');
    this.ws = new WebSocket(`${wsUrl}/ws`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.ws.send(JSON.stringify({
        type: 'create_room',
        presenterToken: this.presenterToken,
        quiz: this.quiz
      }));
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      if (this.currentState !== 'ended' && this.reconnectAttempts < this.maxReconnectAttempts) {
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connectWebSocket();
        }, this.reconnectDelay * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        this.roomId = msg.roomId;
        this.renderLobby();
        this.openControlWindow();
        break;

      case 'participant_joined':
        this.updateParticipantCount(msg.count);
        break;

      case 'participant_left':
        this.updateParticipantCount(msg.count);
        break;

      case 'question':
        this.renderQuestion(msg.question, msg.questionIndex, msg.totalQuestions, msg.startTime);
        break;

      case 'results':
        this.renderResults(msg.leaderboard, msg.questionIndex, msg.waiting);
        break;

      case 'game_ended':
        this.renderFinalResults(msg.leaderboard);
        break;

      case 'answer_accepted':
        // Only relevant if used as a participant client; ignore if results already shown
        if (this.currentState !== 'results' && this.currentState !== 'ended') {
          this.currentState = 'answer_accepted';
          // Disable the submit button to prevent double submission
          const submitBtn = this.shadowRoot.getElementById('quiz-submit-btn');
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitted';
          }
          // Disable option clicks
          this.shadowRoot.querySelectorAll('.quiz-option').forEach(opt => {
            opt.style.pointerEvents = 'none';
          });
        }
        break;

      case 'error':
        this.showError(msg.message);
        break;
    }
  }

  renderLobby() {
    this.currentState = 'lobby';
    const joinUrl = `${this.serverUrl}/join.html?room=${this.roomId}`;
    
    this.contentEl.innerHTML = `
      <div class="quiz-lobby">
        <h2 class="quiz-title">${this.quiz.title || 'Quiz'}</h2>
        <div class="quiz-participant-count">Participants: <span id="count">0</span></div>
        <div class="quiz-qr-container">
          <canvas id="qr-canvas"></canvas>
        </div>
        <div class="quiz-join-url">${joinUrl}</div>
        <div class="quiz-info">Room: ${this.roomId}</div>
        <div class="quiz-controls">
          <button class="quiz-btn quiz-btn-secondary" id="btn-control">Open Control Window</button>
        </div>
      </div>
    `;

    const canvas = this.shadowRoot.getElementById('qr-canvas');
    QRCode.toCanvas(canvas, joinUrl, { width: 200, colorDark: '#1e293b', colorLight: '#ffffff' });

    const btnControl = this.shadowRoot.getElementById('btn-control');
    btnControl.addEventListener('click', () => this.openControlWindow());
  }

  updateParticipantCount(count) {
    const countEl = this.shadowRoot.getElementById('count');
    if (countEl) countEl.textContent = count;
  }

  openControlWindow() {
    const controlUrl = `${this.serverUrl}/control.html?token=${this.presenterToken}&room=${this.roomId}`;
    const popup = window.open(controlUrl, 'quiz-control', 'width=900,height=700,scrollbars=yes');
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // Popup blocked - show fallback
      const existingBtn = this.shadowRoot.getElementById('btn-control');
      if (existingBtn) {
        const info = document.createElement('div');
        info.className = 'quiz-info';
        info.innerHTML = `Control window blocked. <a href="${controlUrl}" target="_blank">Click here to open control window</a>`;
        existingBtn.parentElement.appendChild(info);
      }
    }
  }

  renderQuestion(question, index, total, startTime) {
    this.currentState = 'question';
    const timeLimit = question.timeLimit || 0;
    let timerHtml = '';
    if (timeLimit > 0) {
      timerHtml = `<div class="quiz-timer" id="timer">${timeLimit}</div>`;
    }

    let optionsHtml = '';
    let submitHtml = '';
    if (question.type === 'multiple-choice' && question.options) {
      optionsHtml = `<div class="quiz-options" id="quiz-options">
        ${question.options.map((opt, i) => `<div class="quiz-option" data-index="${i}">${opt}</div>`).join('')}
      </div>`;
      submitHtml = `<button class="quiz-btn quiz-btn-primary" id="quiz-submit-btn" style="margin-top:1rem;width:100%">Submit</button>`;
    }

    this.contentEl.innerHTML = `
      <div class="quiz-question">
        <div class="quiz-question-counter">Question ${index + 1} of ${total}</div>
        ${timerHtml}
        <div class="quiz-question-text" id="question-text">${question.text}</div>
        ${optionsHtml}
        ${submitHtml}
      </div>
    `;

    if (question.type === 'multiple-choice' && question.options) {
      const selected = new Set();
      const optionsEl = this.shadowRoot.getElementById('quiz-options');
      const submitBtn = this.shadowRoot.getElementById('quiz-submit-btn');
      optionsEl.querySelectorAll('.quiz-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const idx = parseInt(opt.dataset.index);
          if (selected.has(idx)) {
            selected.delete(idx);
            opt.classList.remove('selected');
          } else {
            selected.add(idx);
            opt.classList.add('selected');
          }
        });
      });
      submitBtn.addEventListener('click', () => {
        const answer = Array.from(selected).sort((a, b) => a - b);
        this.ws.send(JSON.stringify({ type: 'submit_answer', answer }));
      });
    }

    if (timeLimit > 0) {
      let remaining = timeLimit;
      const timerEl = this.shadowRoot.getElementById('timer');
      this.timerInterval = setInterval(() => {
        remaining--;
        if (timerEl) {
          timerEl.textContent = remaining;
          if (remaining <= 5) timerEl.classList.add('urgent');
        }
        if (remaining <= 0) {
          clearInterval(this.timerInterval);
        }
      }, 1000);
    }
  }

  renderResults(leaderboard, questionIndex, waiting) {
    this.currentState = 'results';
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    const listHtml = leaderboard.map((entry, i) => `
      <div class="quiz-leaderboard-item">
        <span class="quiz-leaderboard-rank">${i + 1}</span>
        <span class="quiz-leaderboard-name">${this.escapeHtml(entry.name)}</span>
        <span class="quiz-leaderboard-score">${entry.score}</span>
      </div>
    `).join('');

    this.contentEl.innerHTML = `
      <div class="quiz-question">
        <div class="quiz-question-counter">Results - Question ${questionIndex + 1}</div>
        <div class="quiz-leaderboard">${listHtml}</div>
        <div class="quiz-info">${waiting ? 'Waiting for next question...' : 'Final results'}</div>
      </div>
    `;
  }

  renderFinalResults(leaderboard) {
    this.currentState = 'ended';
    const listHtml = leaderboard.map((entry, i) => `
      <div class="quiz-leaderboard-item">
        <span class="quiz-leaderboard-rank">${i + 1}</span>
        <span class="quiz-leaderboard-name">${this.escapeHtml(entry.name)}</span>
        <span class="quiz-leaderboard-score">${entry.score}</span>
      </div>
    `).join('');

    this.contentEl.innerHTML = `
      <div class="quiz-question">
        <h2 class="quiz-title">Final Results</h2>
        <div class="quiz-leaderboard">${listHtml}</div>
        <div class="quiz-controls">
          <button class="quiz-btn quiz-btn-secondary" id="btn-restart">New Quiz</button>
        </div>
      </div>
    `;

    const btnRestart = this.shadowRoot.getElementById('btn-restart');
    btnRestart.addEventListener('click', () => {
      location.reload();
    });
  }

  showError(message) {
    this.contentEl.innerHTML = `<div class="quiz-error">${this.escapeHtml(message)}</div>`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

customElements.define('ld-quiz', QuizHost);
