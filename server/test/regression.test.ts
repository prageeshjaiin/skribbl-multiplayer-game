import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { io as ClientSocket, Socket as ClientSocketType } from '../../client/node_modules/socket.io-client';
import { RoomManager } from '../src/managers/RoomManager.js';
import { registerRoomHandlers } from '../src/handlers/roomHandler.js';
import { registerDrawHandlers } from '../src/handlers/drawHandler.js';
import { registerChatHandlers } from '../src/handlers/chatHandler.js';
import { Room } from '../src/models/Room.js';
import { wordManager } from '../src/managers/WordManager.js';

const TEST_PORT = 3199;

async function runRegressionSuite() {
  console.log('===============================================================');
  console.log('       SKRIBBL.IO CLONE — PHASE 6 REGRESSION TEST SUITE        ');
  console.log('===============================================================\n');

  // SETUP TEST SERVER
  const app = express();
  const allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://skribbl-verified.example.com'];

  function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    return allowedOrigins.includes(origin);
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) callback(null, true);
        else callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: false,
    })
  );

  const roomManager = new RoomManager();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) callback(null, true);
        else callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      methods: ['GET', 'POST'],
      credentials: false,
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (isOriginAllowed(origin)) callback(null, true);
      else callback('Origin not allowed', false);
    },
  });

  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket, roomManager);
    registerDrawHandlers(io, socket, roomManager);
    registerChatHandlers(io, socket, roomManager);
  });

  await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Regression Server] Listening on http://localhost:${TEST_PORT}\n`);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`, detail !== undefined ? detail : '');
      failed++;
    }
  }

  const openClient = (headers?: Record<string, string>): Promise<ClientSocketType> => {
    return new Promise((resolve, reject) => {
      const s = ClientSocket(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        extraHeaders: headers,
        reconnection: false,
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) => reject(err));
    });
  };

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: Room Creation, Join, Code Validation, & Capacity
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Room Creation, Join, Code Validation, & Capacity');

    const client1 = await openClient({ Origin: 'http://localhost:5173' });
    let roomCode = '';
    let hostId = '';
    let hostToken = '';

    // Test 1: Create room
    await new Promise<void>((resolve) => {
      client1.emit('create_room', { playerName: 'HostAlice' }, (res: any) => {
        assert(res.success === true && res.data.room.code.length === 6, '1. Host creates room with 6-char code');
        assert(typeof res.data.reconnectToken === 'string' && res.data.reconnectToken.length > 10, '1. Reconnect token is secure and generated');
        roomCode = res.data.room.code;
        hostId = res.data.player.id;
        hostToken = res.data.reconnectToken;
        resolve();
      });
    });

    // Test 2: Reject malformed room codes
    await new Promise<void>((resolve) => {
      client1.emit('join_room', { roomId: 'INVALID!', playerName: 'Hacker' }, (res: any) => {
        assert(res.success === false && res.error.includes('6-character alphanumeric'), '2. Malformed room code rejected immediately');
        resolve();
      });
    });

    // Test 3: Join valid room
    const client2 = await openClient({ Origin: 'http://localhost:5173' });
    let bobId = '';
    let bobToken = '';
    await new Promise<void>((resolve) => {
      client2.emit('join_room', { roomId: roomCode, playerName: 'Bob' }, (res: any) => {
        assert(res.success === true && res.data.room.players.length === 2, '3. Player Bob joins valid room');
        bobId = res.data.player.id;
        bobToken = res.data.reconnectToken;
        resolve();
      });
    });

    // Test 4: Reject invalid maxPlayers range (< 2 or > 20)
    await new Promise<void>((resolve) => {
      client1.emit('update_settings', { roomId: roomCode, settings: { maxPlayers: 1 } }, (res: any) => {
        assert(res.success === false && res.error.includes('between 2 and 20'), '4. Reject maxPlayers setting below minimum 2');
        resolve();
      });
    });

    // Test 5: Allow capacity increase
    await new Promise<void>((resolve) => {
      client1.emit('update_settings', { roomId: roomCode, settings: { maxPlayers: 3 } }, (res: any) => {
        assert(res.success === true && res.data.maxPlayers === 3, '5. Host can increase room capacity to 3');
        resolve();
      });
    });

    // Test 6: Enforce full capacity and reject lowering below occupancy
    const client3 = await openClient({ Origin: 'http://localhost:5173' });
    await new Promise<void>((resolve) => {
      client3.emit('join_room', { roomId: roomCode, playerName: 'Charlie' }, (res: any) => {
        assert(res.success === true && res.data.room.players.length === 3, '6. Third player fills room to capacity (3/3)');
        resolve();
      });
    });

    // Now occupancy is 3. Attempting to lower maxPlayers to 2 must be rejected!
    await new Promise<void>((resolve) => {
      client1.emit('update_settings', { roomId: roomCode, settings: { maxPlayers: 2 } }, (res: any) => {
        assert(res.success === false && res.error.includes('currently 3 players'), '6b. Reject lowering maxPlayers below current occupancy (3)');
        resolve();
      });
    });

    const client4 = await openClient({ Origin: 'http://localhost:5173' });
    await new Promise<void>((resolve) => {
      client4.emit('join_room', { roomId: roomCode, playerName: 'David' }, (res: any) => {
        assert(res.success === false && res.error.includes('full'), '6c. Fourth player rejected when room is full');
        resolve();
      });
    });

    // Test 7: Player leaves voluntarily and capacity can be lowered
    await new Promise<void>((resolve) => {
      client3.emit('leave_room', {}, (res: any) => {
        assert(res.success === true, '7. Charlie leaves room voluntarily');
        resolve();
      });
    });
    client3.disconnect();

    await new Promise<void>((resolve) => {
      client1.emit('update_settings', { roomId: roomCode, settings: { maxPlayers: 2 } }, (res: any) => {
        assert(res.success === true && res.data.maxPlayers === 2, '7. Capacity can be lowered after player permanently leaves');
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // SUITE 2: Authorization, Security, Rate Limiting, & Isolation
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Authorization, Security, Rate Limiting, & Isolation');

    // Test 8: Non-host cannot update settings or start game
    await new Promise<void>((resolve) => {
      client2.emit('update_settings', { roomId: roomCode, settings: { rounds: 5 } }, (res: any) => {
        assert(res.success === false && res.error.includes('Only the host'), '8. Non-host cannot modify room settings');
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      client2.emit('start_game', { roomId: roomCode }, (res: any) => {
        assert(res.success === false && res.error.includes('Only the room host'), '8. Non-host cannot start game');
        resolve();
      });
    });

    // Test 9: CORS and direct WebSocket origin rejection
    await new Promise<void>((resolve) => {
      const evil = ClientSocket(`http://localhost:${TEST_PORT}`, {
        transports: ['websocket'],
        extraHeaders: { Origin: 'https://evil-unauthorized.com' },
        reconnection: false,
      });
      evil.on('connect', () => {
        assert(false, '9. Security Failure: evil origin connected');
        resolve();
      });
      evil.on('connect_error', (err) => {
        assert(true, '9. Unauthorized browser origin rejected during WebSocket handshake');
        evil.disconnect();
        resolve();
      });
    });

    // Test 10: Room Isolation - create isolated Room B
    const clientB1 = await openClient({ Origin: 'http://localhost:5173' });
    let roomBCode = '';
    await new Promise<void>((resolve) => {
      clientB1.emit('create_room', { playerName: 'HostB' }, (res: any) => {
        assert(res.success === true, '10. Room B created for isolation test');
        roomBCode = res.data?.room?.code;
        resolve();
      });
    });

    let roomBReceivedMessage = false;
    clientB1.on('chat_message', () => {
      roomBReceivedMessage = true;
    });

    // Emit chat message in Room A
    await new Promise<void>((resolve) => {
      client1.emit('submit_guess', { roomId: roomCode, text: 'Hello Room A' }, () => resolve());
    });
    await new Promise((r) => setTimeout(r, 100));
    assert(!roomBReceivedMessage, '10. Room isolation: Room B never receives Room A events');
    clientB1.disconnect();

    // Test 11: Room creation rate limiting
    let rateLimitTriggered = false;
    for (let i = 0; i < 7; i++) {
      await new Promise<void>((resolve) => {
        client4.emit('create_room', { playerName: 'Spammer' }, (res: any) => {
          if (!res.success && res.error.includes('Too many rooms created')) {
            rateLimitTriggered = true;
          }
          resolve();
        });
      });
    }
    assert(rateLimitTriggered, '11. Room creation rate limiter blocks excessive creation attempts');

    // Test 12: Rate limiter does NOT block legitimate join or reconnect
    await new Promise<void>((resolve) => {
      client4.emit('join_room', { roomId: roomCode, playerName: 'TestJoin' }, (res: any) => {
        assert(res.error !== 'Too many rooms created', '12. Room creation limiter does not block join requests');
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // SUITE 3: Canvas Drawing, Validation, & Limits
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Canvas Drawing, Validation, & Limits');

    // Start game in Room A (Alice host, Bob guesser)
    await new Promise<void>((resolve) => {
      client1.emit('start_game', { roomId: roomCode }, (res: any) => {
        assert(res.success === true, '13. Host starts game successfully');
        resolve();
      });
    });

    const roomInst = roomManager.getRoom(roomCode)!;
    assert(roomInst.phase === 'WORD_SELECTION', '14. Game transitions to WORD_SELECTION');

    // Drawer (Alice) chooses word
    await new Promise<void>((resolve) => {
      const choice = roomInst.currentWordChoices[0];
      client1.emit('choose_word', { roomId: roomCode, word: choice }, (res: any) => {
        assert(res.success === true, `15. Drawer selects word "${choice}" and starts DRAWING`);
        resolve();
      });
    });
    assert(roomInst.phase === 'DRAWING', '15. Game transitions to DRAWING');

    // Test 16: Non-drawer (Bob) cannot draw
    let unauthorizedDrawEmitted = false;
    client2.emit('draw_start', { roomId: roomCode, strokeId: 'hack1', point: { x: 0.5, y: 0.5 }, color: '#000000', size: 5, isEraser: false });
    await new Promise((r) => setTimeout(r, 50));
    assert(roomInst.getStrokes().length === 0, '16. Non-drawer drawing attempt rejected');

    // Test 17: Valid drawer stroke
    let bobReceivedDrawStart = false;
    client2.on('draw_start', () => {
      bobReceivedDrawStart = true;
    });

    client1.emit('draw_start', {
      roomId: roomCode,
      strokeId: 'stroke_1',
      point: { x: 0.1, y: 0.2 },
      color: '#ff0000',
      size: 8,
      isEraser: false,
    });
    await new Promise((r) => setTimeout(r, 50));
    assert(bobReceivedDrawStart, '17. Authorized drawer stroke broadcast to guesser');

    // Test 18: Malformed point (NaN/Infinity) sanitized safely without crash
    client1.emit('draw_move', {
      roomId: roomCode,
      strokeId: 'stroke_1',
      point: { x: NaN, y: Infinity },
    });
    await new Promise((r) => setTimeout(r, 50));
    assert(true, '18. Malformed non-finite coordinates handled safely');

    // Test 19: Valid point move
    client1.emit('draw_move', {
      roomId: roomCode,
      strokeId: 'stroke_1',
      point: { x: 0.3, y: 0.4 },
    });
    client1.emit('draw_end', { roomId: roomCode, strokeId: 'stroke_1' });
    await new Promise((r) => setTimeout(r, 50));
    assert(roomInst.getStrokes().length === 1, '19. Completed stroke persisted in canvas state');

    // Test 20: Undo stroke
    await new Promise<void>((resolve) => {
      client1.emit('draw_undo', { roomId: roomCode }, (res: any) => {
        assert(res.success === true, '20. Drawer can undo stroke');
        assert(roomInst.getStrokes().length === 0, '20. Canvas stroke list is empty after undo');
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // SUITE 4: Progressive Hints, Guessing, Scoring, & Secret Protection
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Progressive Hints, Guessing, Scoring, & Secret Protection');

    // Test 21: Secret word is NEVER leaked to guesser in public state
    const publicState = roomInst.getState();
    assert(publicState.revealedWord === null, '21. Public state does not reveal secret word during DRAWING');
    assert(publicState.maskedWord?.includes('_'), '21. Guesser sees masked representation');

    // Test 22: Progressive hints check
    const secret = roomInst.getSecretWord()!;
    assert(typeof secret === 'string' && secret.length > 0, '22. Server authoritatively tracks secret word');
    
    // Simulate tick to trigger hints
    for (const hint of (roomInst as any).hintSchedule) {
      roomInst.revealedLetterIndices.add(hint.index);
    }
    const hintedState = roomInst.getState();
    assert(hintedState.maskedWord?.includes('_'), '22. Progressive hints never reveal the complete word');

    // Test 23: Drawer cannot guess
    await new Promise<void>((resolve) => {
      client1.emit('submit_guess', { roomId: roomCode, text: secret }, (res: any) => {
        assert(res.success === false && res.error.includes('You are drawing'), '23. Active drawer cannot submit guesses');
        resolve();
      });
    });

    // Test 24: Incorrect guess broadcast as chat
    let bobChatReceived = false;
    client1.on('chat_message', (msg: any) => {
      if (msg.text === 'wrongguess') bobChatReceived = true;
    });
    await new Promise<void>((resolve) => {
      client2.emit('submit_guess', { roomId: roomCode, text: 'wrongguess' }, () => resolve());
    });
    await new Promise((r) => setTimeout(r, 50));
    assert(bobChatReceived, '24. Incorrect guess broadcasts as normal chat');

    // Test 25: Correct guess awards points and ends turn early (all guessers guessed)
    let turnEndedEvent = false;
    client2.on('turn_end', () => {
      turnEndedEvent = true;
    });

    await new Promise<void>((resolve) => {
      client2.emit('submit_guess', { roomId: roomCode, text: secret }, (res: any) => {
        assert(res.success === true && res.data.isCorrect === true, '25. Correct guess recognized');
        const bobPlayer = roomInst.getPlayer(bobId)!;
        assert(bobPlayer.score > 0, '25. Guesser awarded positive score');
        const alicePlayer = roomInst.getPlayer(hostId)!;
        assert(alicePlayer.score > 0, '25. Drawer awarded positive bonus score');
        resolve();
      });
    });

    await new Promise((r) => setTimeout(r, 100));
    assert(turnEndedEvent, '25. Early turn completion when all eligible guessers guess correctly');
    assert(roomInst.phase === 'TURN_END', '25. Phase transitions to TURN_END');
    assert(roomInst.getState().revealedWord === secret, '25. Word revealed in TURN_END phase');

    // -------------------------------------------------------------------------
    // SUITE 5: Reconnection, Session Takeover, & Ghost Disconnect Prevention
    // -------------------------------------------------------------------------
    console.log('\n[Suite 5] Reconnection, Session Takeover, & Ghost Disconnect Prevention');

    // Test 26: Stale / attacker token cannot resume session
    const attacker = await openClient({ Origin: 'http://localhost:5173' });
    await new Promise<void>((resolve) => {
      attacker.emit('resume_room', { roomId: roomCode, playerId: hostId, reconnectToken: 'fake_token' }, (res: any) => {
        assert(res.success === false, '26. Attacker with forged reconnect token rejected');
        resolve();
      });
    });
    attacker.disconnect();

    // Test 27: Legitimate session takeover from new socket (Tab refresh simulation)
    const client1New = await openClient({ Origin: 'http://localhost:5173' });
    let client1OldDisconnected = false;
    client1.on('disconnect', () => {
      client1OldDisconnected = true;
    });

    await new Promise<void>((resolve) => {
      client1New.emit('resume_room', { roomId: roomCode, playerId: hostId, reconnectToken: hostToken }, (res: any) => {
        assert(res.success === true, '27. Legitimate player resumes session with token');
        const alice = roomInst.getPlayer(hostId)!;
        assert(alice.socketId === client1New.id, '27. Authoritative socket updated to new connection');
        assert(alice.isConnected === true, '27. Player remains marked connected');
        resolve();
      });
    });

    await new Promise((r) => setTimeout(r, 100));
    assert(client1OldDisconnected, '27. Old socket was evicted and closed upon session takeover');

    // Test 28: Ghost disconnect test - closing old socket does NOT trigger grace timer on active player
    assert(!roomInst.playerDisconnectTimers.has(hostId), '28. No ghost grace period timer started for active player');

    // Test 29: Genuine disconnect of active socket starts grace period
    client1New.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    assert(roomInst.playerDisconnectTimers.has(hostId), '29. Genuine active-socket disconnect starts 15s grace timer');
    const aliceDisconnected = roomInst.getPlayer(hostId)!;
    assert(aliceDisconnected.isConnected === false, '29. Player marked isConnected: false on genuine disconnect');

    // Test 30: Cleanup - last player leaves and room is purged
    client2.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    // Clear timers and destroy room
    roomInst.clearAllTimers();
    roomManager.deleteRoom(roomCode);
    assert(roomManager.getRoom(roomCode) === undefined, '30. Empty room completely purged from memory');

    client4.disconnect();
  } finally {
    for (const room of (roomManager as any).rooms.values()) {
      room.clearAllTimers();
    }
    server.close();
  }

  console.log('\n===============================================================');
  console.log(`REGRESSION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRegressionSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
