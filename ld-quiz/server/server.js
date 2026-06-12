import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RoomManager } from './rooms.js';
import { renderQuiz } from './math-renderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();

// CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(o => o.trim());

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

app.use(corsMiddleware);

// Serve static files
app.use(express.static(join(__dirname, '../public')));
app.use('/shared', express.static(join(__dirname, '../shared')));
app.use('/client', express.static(join(__dirname, '../client')));
app.use('/katex', express.static(join(__dirname, '../node_modules/katex/dist')));

// API endpoint for presenter sessions
app.get('/api/sessions', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }
  const sessions = roomManager.getPresenterRooms(token);
  res.json({ sessions });
});

// WebSocket handling
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => handleDisconnect(ws));
  ws.on('message', (data) => handleMessage(ws, data));
});

// Keep connections alive
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function handleMessage(ws, data) {
  try {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'create_room': {
        const { presenterToken, quiz } = msg;
        const renderedQuiz = renderQuiz(quiz);
        const room = roomManager.createRoom(presenterToken, renderedQuiz);
        room.setPresenter(ws);
        ws.roomId = room.roomId;
        ws.role = 'presenter';
        
        ws.send(JSON.stringify({
          type: 'room_created',
          roomId: room.roomId,
          quizTitle: room.quiz.title,
          totalQuestions: room.quiz.questions.length
        }));
        break;
      }

      case 'join_room': {
        const { roomId, name } = msg;
        const room = roomManager.getRoom(roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        
        const participant = room.addParticipant(ws, name);
        ws.roomId = roomId;
        ws.role = 'participant';
        ws.participantId = participant.id;
        
        ws.send(JSON.stringify({
          type: 'joined',
          participantId: participant.id,
          roomId: roomId,
          quizTitle: room.quiz.title
        }));

        // Notify presenter
        room.sendToPresenter({
          type: 'participant_joined',
          participantId: participant.id,
          name: participant.name,
          count: room.getParticipantCount()
        });

        // Send current question if game is in progress
        if (room.state === 'question') {
          const question = room.getPublicQuestion();
          ws.send(JSON.stringify({
            type: 'question',
            questionIndex: room.currentQuestionIndex,
            totalQuestions: room.quiz.questions.length,
            question: question,
            startTime: room.currentQuestionStartTime
          }));
        } else if (room.state === 'results') {
          // Send results
          const results = room.getLeaderboard();
          ws.send(JSON.stringify({
            type: 'results',
            questionIndex: room.currentQuestionIndex,
            leaderboard: results,
            waiting: room.currentQuestionIndex < room.quiz.questions.length - 1
          }));
        }
        break;
      }

      case 'control_connect': {
        const { presenterToken, roomId } = msg;
        
        if (roomId) {
          // Connect to specific room
          const room = roomManager.getRoom(roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
            return;
          }
          if (room.presenterToken !== presenterToken) {
            ws.send(JSON.stringify({ type: 'error', message: 'Access denied' }));
            return;
          }
          
          room.setPresenter(ws);
          ws.roomId = roomId;
          ws.role = 'presenter';
          
          ws.send(JSON.stringify({
            type: 'control_connected',
            roomId: room.roomId,
            state: room.state,
            quizTitle: room.quiz.title,
            totalQuestions: room.quiz.questions.length,
            currentQuestionIndex: room.currentQuestionIndex,
            participantCount: room.getParticipantCount(),
            leaderboard: room.getLeaderboard()
          }));
        } else {
          // List sessions
          const sessions = roomManager.getPresenterRooms(presenterToken);
          ws.send(JSON.stringify({
            type: 'sessions_list',
            sessions
          }));
        }
        break;
      }

      case 'start_game': {
        const room = getRoomForPresenter(ws);
        if (!room) return;
        
        room.startGame();
        const question = room.getPublicQuestion();
        
        room.broadcastToParticipants({
          type: 'question',
          questionIndex: 0,
          totalQuestions: room.quiz.questions.length,
          question: question,
          startTime: room.currentQuestionStartTime
        });
        
        room.sendToPresenter({
          type: 'game_started',
          questionIndex: 0,
          participantCount: room.getParticipantCount()
        });
        break;
      }

      case 'end_question': {
        const room = getRoomForPresenter(ws);
        if (!room) return;
        
        const results = room.endQuestion();
        
        room.broadcastToParticipants({
          type: 'results',
          questionIndex: room.currentQuestionIndex,
          leaderboard: results.leaderboard,
          waiting: room.currentQuestionIndex < room.quiz.questions.length - 1
        });
        
        room.sendToPresenter({
          type: 'question_results',
          questionIndex: room.currentQuestionIndex,
          answers: Array.from(room.currentAnswers.entries()).map(([pid, data]) => {
            const p = room.getParticipantById(pid);
            return {
              participantId: pid,
              name: p?.name || 'Unknown',
              answer: data.answer,
              points: results.scores.get(pid) || 0,
              timestamp: data.timestamp
            };
          }),
          leaderboard: results.leaderboard
        });
        break;
      }

      case 'next_question': {
        const room = getRoomForPresenter(ws);
        if (!room) return;
        
        if (room.nextQuestion()) {
          const question = room.getPublicQuestion();
          
          room.broadcastToParticipants({
            type: 'question',
            questionIndex: room.currentQuestionIndex,
            totalQuestions: room.quiz.questions.length,
            question: question,
            startTime: room.currentQuestionStartTime
          });
          
          room.sendToPresenter({
            type: 'question_started',
            questionIndex: room.currentQuestionIndex,
            question: room.getCurrentQuestion()
          });
        } else {
          // End game
          room.state = 'ended';
          const finalLeaderboard = room.getLeaderboard();
          
          room.broadcast({
            type: 'game_ended',
            leaderboard: finalLeaderboard
          });
        }
        break;
      }

      case 'submit_answer': {
        const room = roomManager.getRoom(ws.roomId);
        if (!room || ws.role !== 'participant') return;
        
        const success = room.submitAnswer(ws.participantId, msg.answer);
        if (success) {
          ws.send(JSON.stringify({ type: 'answer_accepted' }));
          
          // Notify presenter of answer count
          room.sendToPresenter({
            type: 'answer_count',
            count: room.currentAnswers.size,
            totalParticipants: room.getParticipantCount()
          });
        }
        break;
      }

      case 'get_participants': {
        const room = getRoomForPresenter(ws);
        if (!room) return;
        
        ws.send(JSON.stringify({
          type: 'participants_list',
          participants: Array.from(room.participants.values()).map(p => ({
            id: p.id,
            name: p.name,
            score: p.score
          }))
        }));
        break;
      }

      case 'kick_participant': {
        const room = getRoomForPresenter(ws);
        if (!room) return;
        
        const participant = room.getParticipantById(msg.participantId);
        if (participant) {
          // Find the websocket
          for (const [pws, p] of room.participants) {
            if (p.id === msg.participantId) {
              pws.send(JSON.stringify({ type: 'kicked' }));
              pws.close();
              break;
            }
          }
        }
        break;
      }

      default:
        console.log('Unknown message type:', msg.type);
    }
  } catch (err) {
    console.error('WebSocket message error:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
  }
}

function getRoomForPresenter(ws) {
  if (ws.role !== 'presenter') return null;
  return roomManager.getRoom(ws.roomId);
}

function handleDisconnect(ws) {
  if (ws.roomId) {
    const room = roomManager.getRoom(ws.roomId);
    if (room) {
      if (ws.role === 'participant') {
        const participant = room.removeParticipant(ws);
        if (participant) {
          room.sendToPresenter({
            type: 'participant_left',
            participantId: participant.id,
            name: participant.name,
            count: room.getParticipantCount()
          });
        }
      } else if (ws.role === 'presenter') {
        // Don't close the room, just note that presenter is offline
        // They can reconnect via control.html
        room.sendToPresenter({
          type: 'presenter_disconnected',
          roomId: room.roomId
        });
      }
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Quiz server running on port ${PORT}`);
});
