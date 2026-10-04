# AFTERLIGHT — The Last Night

A real-time 1–8 player story party-game prototype.

## Run locally
1. Install Node.js 18+.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` on the host machine.

For other devices on the same network, open `http://YOUR-LAN-IP:3000`.

## Current build
- 1–8 player rooms with short room codes
- Real-time player list via Socket.IO
- Branching 5-chapter story
- Group voting and synchronized story progression
- Text chat
- Solo mode (runs as an auto-started one-player room)
- Story locations shown after each vote; endings depend on your choices (truth vs. bond)
- Microphone permission/ready UI
- Responsive mobile-friendly interface
- Multiple ending presentation

## Production note
The microphone control currently verifies browser microphone permission but does not yet route live audio between players. Production voice requires WebRTC peer connections plus a signaling flow (the Socket.IO server already provides a natural signaling channel). Authentication, persistence, rate limiting, and deployment configuration should be added before public launch.

## Known limits
- Refreshing the page drops you from the room (no reconnect yet).
- Rooms live in memory only; restarting the server clears them.
- Browsers only allow the microphone on `localhost` or HTTPS, so the mic button won't work over a plain LAN IP.
