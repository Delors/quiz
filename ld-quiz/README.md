# ld-quiz

A real-time, embeddable quiz application designed for integration with **LectureDoc2** and any HTML-based presentation system. The core is a vanilla JavaScript **Web Component** (`<ld-quiz>`) that handles presenter authentication, quiz decryption, participant management, and real-time game flow.

## Features

- **Web Component Architecture**: Embeddable in any HTML document using Shadow DOM for style isolation
- **Real-time Gameplay**: Native WebSocket communication for live quiz sessions
- **Secure Quiz Content**: Client-side AES-GCM encryption with PBKDF2 key derivation
- **Presenter Control**: Separate control window with session management and reconnection support
- **Participant QR Code Join**: Participants scan a QR code or use a short link to join
- **Math Formula Support**: KaTeX rendering for quiz questions and answers
- **Minimal Dependencies**: Express.js and `ws` (WebSocket) on the server; zero dependencies on the client

## Supported Question Types

1. **Multiple Choice**: Standard A/B/C selection with one correct answer (100 points)
2. **Estimation**: Numeric answers with rank-based scoring:
   - 1st closest: 100 points
   - 2nd closest: 50 points
   - 3rd closest: 25 points
   - Tie-breaker: earliest submission wins

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

### 4. Start the Server

For development:

```bash
node server/server.js
# Server runs on http://localhost:3000
```

For production, see [Production Deployment](#6-production-deployment) below.

### 5. Embed the Quiz

The `<ld-quiz>` component supports both **encrypted** and **unencrypted** quizzes.

#### Encrypted Quiz (password required)

Add the `encrypted` attribute and provide the encrypted quiz data:

```html
<ld-quiz encrypted encrypted-quiz="MTAwMDAw:abc123...encrypted-data..." server-url="https://quiz.example.com"></ld-quiz>
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

### Cross-Origin Deployment

When the slide server and quiz server are on different origins, the quiz server must allow cross-origin requests. The server is configured with CORS by default (`*` origin), but you can restrict it:

```bash
# Allow any origin (default, for development)
ALLOWED_ORIGINS="*" node server/server.js

# Restrict to specific origins
ALLOWED_ORIGINS="https://slides.example.com,https://presenter.example.com" node server/server.js
```

The client component automatically loads its CSS from the quiz server, so CORS is required for the stylesheet request as well.

### 6. Production Deployment

For production, use **pm2** to ensure the server restarts automatically after crashes:

```bash
# Install pm2 globally (if not already installed)
pnpm add -g pm2

# Start the server with pm2
cd server
pm2 start server.js --name "quiz-server"

# Save the pm2 process list so it auto-starts on boot
pm2 save
pm2 startup  # Follow the generated command to enable auto-start

# Monitor and manage
pm2 status           # View running processes
pm2 logs quiz-server # View server logs
pm2 monit            # Interactive dashboard
pm2 reload quiz-server # Zero-downtime reload
```

**Why pm2?**
- Cross-platform: works on macOS, Linux, and Windows
- Auto-restart on crash or memory limit
- Built-in log aggregation and monitoring
- `pm2 startup` auto-generates the correct systemd/launchd service for any OS

### 7. Run the Quiz

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
| `encrypted` | No | Presence attribute. If set, the quiz requires password decryption |
| `encrypted-quiz` | Yes (if encrypted) | The encrypted quiz ciphertext string |
| `quiz` | Yes (if not encrypted) | Inline JSON string of the quiz (alternative to file upload) |
| `server-url` | No | The quiz server URL. Defaults to `window.location.origin` |

## Quiz JSON Format
- `text`: Question text (supports KaTeX math with `\(...\)` and `\[...\]` delimiters)
- `options`: Array of strings (for multiple-choice)
- `correctIndices`: Array of zero-based indices of correct options (for multiple-choice). Single-answer questions use a one-element array, e.g. `[0]`. Multi-select questions use multiple indices, e.g. `[0, 2]`.
- `correctAnswer`: Numeric value (for estimation)
- `timeLimit`: Optional countdown timer in seconds

## Security Model

- The quiz JSON is encrypted on the client side using the presenter's password
- The server receives the **decrypted** quiz only after the presenter logs in
- The server never persists quiz data to disk; all data is ephemeral (in-memory only)
- The presenter authenticates with a SHA-256 hash of their password
- Participants require no authentication; they join via a random room code
- **Cross-origin**: The quiz server allows CORS from any origin by default. For production, restrict with `ALLOWED_ORIGINS`

## Server API

### WebSocket Messages

**Presenter → Server:**
- `create_room`: Create a new quiz room
- `start_game`: Begin the quiz
- `end_question`: End the current question and show results
- `next_question`: Advance to the next question
- `control_connect`: Connect to an existing room (for reconnection)

**Participant → Server:**
- `join_room`: Join a room with a name
- `submit_answer`: Submit an answer

**Server → Client:**
- `question`: New question available
- `results`: Round results with leaderboard
- `game_ended`: Final results
- `participant_joined` / `participant_left`: Lobby updates

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

Start the server and open the demo page:

```bash
node server/server.js
# Open http://localhost:3000/demo.html
# Use password: test123
```

### KaTeX Integration

The quiz component attempts to render math using `renderMathInElement` from KaTeX. To enable this, include KaTeX in your host page:

```html
<link rel="stylesheet" href="/katex/katex.min.css">
<script defer src="/katex/katex.min.js"></script>
<script defer src="/katex/contrib/auto-render.min.js"></script>
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
