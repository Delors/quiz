# ld-quiz

## Project Structure

```
ld-quiz/
├── server/
│   ├── server.js          # Express + WebSocket server
│   ├── rooms.js           # Room state management and scoring
│   └── package.json       # Server dependencies
├── client/
│   ├── ld-quiz.js         # Main <ld-quiz> web component
│   ├── ld-quiz-bridge.js  # LectureDoc2 integration bridge
│   ├── quiz-client.js     # Participant join page logic
│   ├── quiz-control.js    # Presenter control page logic
│   ├── qrcode.min.js      # Minimal QR code generator (zero deps)
│   └── quiz-styles.css    # Shadow DOM styles
├── shared/
│   └── ld-crypto.js       # AES-GCM + PBKDF2 encryption library
├── lib/
│   └── encrypt-quiz.js      # CLI utility to encrypt quiz JSON
└── public/
    ├── join.html            # Participant join page
    ├── control.html         # Presenter control page
    └── demo.html            # Standalone demo page
```

The repository root also contains a `Caddyfile` and the `caddy/` snippet files used to deploy the app.

## Quick Start

### 1. Install Server Dependencies

```bash
cd server
pnpm install
```

### 2. Create a Quiz

Create a JSON file with your quiz questions:

```json
{
  "title": "Mathematics Quiz",
  "questions": [
    {
      "type": "multiple-choice",
      "text": "What is the derivative of \\( x^2 \\)?",
      "options": [
        "\\( 2x \\)",
        "\\( x \\)",
        "\\( x^2 \\)"
      ],
      "correctIndices": [0],
      "timeLimit": 30
    },
    {
      "type": "estimation",
      "text": "Estimate the value of \\( \\sqrt{2} \\) to 2 decimal places.",
      "correctAnswer": 1.41,
      "timeLimit": 45
    }
  ]
}
```

### 3. Encrypt the Quiz

```bash
node lib/encrypt-quiz.js my-quiz.json my-quiz-encrypted.txt
# Enter your password when prompted
```

### 4. Start the Backend

The Node backend exposes only the API and WebSocket endpoint. In production it should sit behind Caddy and not be reached directly from browsers.

```bash
cd server
pnpm install
node server.js
# Backend listens on http://localhost:3000
```

### 5. Start Caddy

Caddy serves the static files (`public/`, `client/`, `shared/`) and proxies API/WebSocket traffic to the backend. Run it from the repository root:

```bash
# Local development with HTTPS (uses the mkcert certificate in the repo root)
CADDY_HOST=localhost TLS_CONFIG=caddy/tls-mkcert.txt caddy run --config Caddyfile

# Local-network development (e.g. for phones on the same Wi-Fi)
CADDY_HOST=192.168.178.161 TLS_CONFIG=caddy/tls-mkcert.txt caddy run --config Caddyfile

# Production (automatic HTTPS via Let's Encrypt / ZeroSSL)
CADDY_HOST=quiz.example.com caddy run --config Caddyfile
```

Open `https://<host>/demo.html` in your browser.

### 6. Embed the Quiz

The `<ld-quiz>` component supports both **encrypted** and **unencrypted** quizzes.

#### Encrypted Quiz (password required)

Add the `encrypted` attribute and provide the encrypted quiz data:

```html
<ld-quiz encrypted quiz="MTAwMDAw:abc123...encrypted-data..." server-url="https://quiz.example.com"></ld-quiz>
<script type="module" src="https://quiz.example.com/client/ld-quiz.js"></script>
```

The presenter will be prompted for a password to decrypt the quiz.

#### Unencrypted Quiz — Inline JSON

Provide the quiz JSON directly via the `quiz` attribute:

```html
<ld-quiz quiz='{"title":"My Quiz","questions":[...]}' server-url="https://quiz.example.com"></ld-quiz>
```

The quiz title is shown with a "Start Quiz" button. No password is required.

#### Unencrypted Quiz — File Upload

If no `quiz` attribute is provided, a file picker is shown:

```html
<ld-quiz server-url="https://quiz.example.com"></ld-quiz>
```

The presenter selects a `.json` file, and the quiz title is shown with a "Start Quiz" button.

> **Note:** The `server-url` attribute is required when the quiz server is hosted on a different domain than the slide set. If omitted, it defaults to the current page's origin.

### 7. Cross-Origin Deployment

When the slide server and quiz server are on different origins, the quiz server must allow cross-origin requests.

Caddy adds permissive CORS headers (`Access-Control-Allow-Origin: *`) to all static-file responses (`/client/*`, `/shared/*`, and the files under `/public`), so stylesheets and ES modules can be loaded from any origin.

For the API, CORS is handled by the Node backend. It allows all origins by default, but you can restrict it:

```bash
# Allow any origin (default, for development)
ALLOWED_ORIGINS="*" node server/server.js

# Restrict to specific origins
ALLOWED_ORIGINS="https://slides.example.com,https://presenter.example.com" node server/server.js
```

### Caddy Configuration

The `Caddyfile` in the repository root is configured through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CADDY_HOST` | `localhost` | Site address (e.g. `localhost`, `192.168.178.161`, `quiz.example.com`) |
| `BACKEND_HOST` | `localhost` | Host of the Node backend |
| `BACKEND_PORT` | `3000` | Port of the Node backend |
| `TLS_CONFIG` | `caddy/tls-auto.txt` | Path to a TLS snippet file. Empty file = automatic HTTPS. Set to `caddy/tls-mkcert.txt` for local HTTPS. |
| `ALLOWED_ORIGINS` | `*` | Origins allowed by the Node API CORS middleware |

### 8. Production Deployment

#### 8.1 Architecture

In production the Node backend should not be exposed directly. Caddy is the public entry point:

- Caddy terminates TLS and serves static files from `ld-quiz/public`, `ld-quiz/client`, and `ld-quiz/shared`.
- API requests (`/api/*`) and WebSocket connections (`/ws`) are proxied to the Node backend.
- The backend can run on `localhost:3000` (or any internal host/port configured via `BACKEND_HOST`/`BACKEND_PORT`).

#### 8.2 Running the backend with pm2

Use **pm2** to keep the backend running and restart it after crashes:

```bash
# Install pm2 globally (if not already installed)
pnpm add -g pm2

# Start the backend
cd server
pm2 start server.js --name "quizzy-server"

# Save the pm2 process list so it auto-starts on boot
pm2 save
pm2 startup  # Follow the generated command to enable auto-start

# Monitor and manage
pm2 status                 # View running processes
pm2 logs quizzy-server     # View server logs
pm2 monit                 # Interactive dashboard
pm2 reload quizzy-server  # Zero-downtime reload
```

#### 8.3 Running Caddy

Run Caddy from the repository root. For automatic HTTPS on a public domain, leave `TLS_CONFIG` unset:

```bash
CADDY_HOST=quiz.example.com \
BACKEND_HOST=localhost \
BACKEND_PORT=3000 \
caddy run --config Caddyfile
```

To run Caddy as a system service, copy or symlink the `Caddyfile` to `/etc/caddy/Caddyfile` and start the service:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
```

Caddy will obtain and renew a TLS certificate automatically.

#### 8.4 TLS

TLS is required because the Web Crypto API (used for hashing and decryption) only works in a secure context. With the production setup, Caddy handles TLS automatically.

If you prefer to use your own certificate, create a snippet file and point `TLS_CONFIG` to it:

```caddy
# caddy/tls-custom.txt
tls /path/to/cert.pem /path/to/key.pem
```



### 9. Run the Quiz

1. Open the page containing the quiz component
2. Enter your password to decrypt and start the quiz
3. The control window opens automatically
4. Participants join by scanning the QR code or visiting the join URL
5. Use the control window to start rounds, end rounds, and advance questions

## Quiz JSON Format

```json
{
  "title": "Quiz Title",
  "questions": [
    {
      "type": "multiple-choice",
      "text": "Question text with optional \\( LaTeX \\) math",
      "options": ["Option A", "Option B", "Option C"],
      "correctIndices": [0],
      "timeLimit": 30
    },
    {
      "type": "estimation",
      "text": "Question text",
      "correctAnswer": 42.0,
      "timeLimit": 45
    }
  ]
}
```

## `<ld-quiz>` Element Attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `encrypted` | No | Presence attribute. If set, the `quiz` value is treated as encrypted ciphertext |
| `quiz` | Yes | The quiz data: encrypted ciphertext (when `encrypted` is present) or inline JSON string |
| `server-url` | No | The quiz server URL. Defaults to `window.location.origin` |

## Quiz JSON Format
- `text`: Question text (supports KaTeX math with `\(...\)` and `\[...\]` delimiters)
- `options`: Array of strings (for multiple-choice)
- `correctIndices`: Array of zero-based indices of correct options (for multiple-choice). Single-answer questions use a one-element array, e.g. `[0]`. Multi-select questions use multiple indices, e.g. `[0, 2]`.
- `correctAnswer`: Numeric value (for estimation)
- `timeLimit`: Optional countdown timer in seconds

## Security Model

- The quiz JSON is encrypted on the client side using the presenter's password
- The server receives the **decrypted** quiz only after the presenter decrypts it
- The server never persists quiz data to disk; all data is ephemeral (in-memory only)
- The presenter uses a SHA-256 hash of the quiz to identify himself.
- Participants require no authentication; they join via a random room code
- **Cross-origin**: The quiz server allows CORS from any origin by default. For production, restrict with `ALLOWED_ORIGINS`

## Server API

### WebSocket Messages

All messages are JSON objects with a `type` field.

**Presenter → Server:**
- `create_room`: Create a new quiz room
  - `presenterToken`: SHA-256 hash of the quiz data or password
  - `quiz`: The quiz object (rendered server-side)
- `start_game`: Begin the quiz
- `end_question`: End the current question and show results
- `next_question`: Advance to the next question or end the game
- `control_connect`: Connect to a room as presenter
  - With `roomId`: join the control channel for that room
  - Without `roomId`: receive a `sessions_list` of all rooms for this presenter

**Participant → Server:**
- `join_room`: Join a room with a name
  - `roomId`: Room to join
  - `name`: Participant display name
- `submit_answer`: Submit an answer
  - `answer`: Selected option index, array of indices, or estimation value

**Server → Presenter (`ld-quiz` component):**
- `room_created`: Room was created; includes `roomId`, `quizTitle`, `totalQuestions`
- `participant_joined` / `participant_left`: Lobby participant count updates

**Server → Control Window (`quiz-control.js`):**
- `control_connected`: Initial state after connecting; includes `roomId`, `state`, `quizTitle`, `totalQuestions`, `currentQuestionIndex`, `question`, `participantCount`, `leaderboard`
- `sessions_list`: List of active sessions when no `roomId` was provided
- `game_started`: Quiz started; includes `questionIndex` and `question`
- `question_started`: Next question is active; includes `questionIndex` and `question`
- `question_results`: Question ended; includes `questionIndex`, `answers`, and `leaderboard`
- `answer_count`: Live count of submitted answers during a question
- `participant_joined` / `participant_left`: Participant count updates

**Server → Participant (`quiz-client.js`):**
- `joined`: Successfully joined; includes `participantId` and `quizTitle`
- `question`: New question available; includes `questionIndex`, `totalQuestions`, `question`, `startTime`
- `results`: Round results with `leaderboard`, `questionIndex`, and `waiting`
- `game_ended`: Final results; includes `leaderboard`

**Server → Broadcast:**
- `game_ended`: Sent to all connected clients when the quiz ends

**Server → Any Client:**
- `error`: Error message from the server

## Development

### Testing

The server includes a comprehensive test suite using Node.js's built-in test runner:

```bash
cd server
pnpm test           # Run all tests
pnpm test:watch     # Run tests in watch mode
```

Tests cover:
- **Room state management**: Participant lifecycle, game flow, scoring logic
- **Crypto operations**: Encryption/decryption roundtrips, error handling
- **Server integration**: CORS headers, HTTP API, WebSocket message flow

### Manual Testing

Start the backend and Caddy, then open the demo page:

```bash
# Terminal 1
cd server
node server.js

# Terminal 2 (repo root)
CADDY_HOST=localhost TLS_CONFIG=caddy/tls-mkcert.txt caddy run --config Caddyfile

# Open https://localhost/demo.html
# Use password: test123
```

Go to, e.g.,: https://192.168.178.161/demo.html to open the application.

### KaTeX Integration

Math formulas in quiz questions and answers are rendered to HTML on the server before they are sent to clients. The client only needs the KaTeX stylesheet to display the rendered math correctly.

When using the `ld-quiz` web component, the stylesheet is fetched automatically from the configured `server-url` and injected into the shadow DOM, so no manual setup is required.

For standalone pages (such as `demo.html`), include the stylesheet in the host page:

```html
<link rel="stylesheet" href="/katex/katex.min.css">
```

For self-hosted KaTeX, download the distribution to `public/katex/`.

## Browser Support

This application targets modern browsers (released within the last year). It uses:
- Web Components (Custom Elements, Shadow DOM)
- ES Modules
- Web Crypto API
- Native WebSocket
- CSS Custom Properties

## License

BSD-3-Clause (same as the underlying crypto library and LectureDoc2)
