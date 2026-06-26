# ld-quiz

A real-time, embeddable quiz application designed for integration with any HTML-based presentation system (e.g., **LectureDoc2**). The core is a vanilla JavaScript **Web Component** (`<ld-quiz>`) that handles presenter authentication, quiz decryption, participant management, and real-time game flow.

## Features

- **Web Component Architecture**: Embeddable in any HTML document using Shadow DOM for style isolation
- **Real-time Gameplay**: Native WebSocket communication for live quiz sessions
- **Secure Quiz Content**: Client-side AES-GCM encryption with PBKDF2 key derivation
- **Presenter Control**: Separate control window with session management and reconnection support
- **Participant QR Code Join**: Participants scan a QR code or use a short link to join
- **Math Formula Support**: Server-based KaTeX rendering for quiz questions and answers
- **Minimal Dependencies**: Express.js and `ws` (WebSocket) on the server; zero dependencies on the client

## Supported Question Types

1. **Multiple Choice**: Standard A/B/C selection
2. **Estimation**: Numeric answers with rank-based scoring:
   - 1st closest: 100 points
   - 2nd closest: 50 points
   - 3rd closest: 25 points
   - Tie-breaker: earliest submission wins
