import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 8;
const rooms = new Map();
const chars = ['Mara', 'Eli', 'Noah', 'Iris', 'Rhea', 'Jon', 'Asha', 'Kai'];

const locations = {
  house:    { name: 'Abandoned House',      icon: '⌂', desc: 'A cold house with a locked study and a child’s drawing on the wall.' },
  forest:   { name: 'Black Pine Forest',    icon: '♧', desc: 'A narrow trail disappears into trees. Something keeps moving between them.' },
  hospital: { name: 'Old Clinic',           icon: '✚', desc: 'Medical records suggest someone has been treated here recently.' },
  tower:    { name: 'Radio Tower',          icon: '⌁', desc: 'A weak distress signal repeats every 43 seconds.' },
  facility: { name: 'Underground Facility', icon: '▣', desc: 'A sealed entrance hums beneath the settlement.' }
};

// Each choice: text, location it leads to, and how much it moves the
// "truth" (uncovering the mystery) and "bond" (keeping the group together) scores.
const chapters = [
  { title: 'The Wake-Up',
    text: 'Rain hammers the windows. You wake on the floor of an abandoned visitor center. Outside, the road is blocked by a fallen tree. Every clock says 2:17 AM.',
    choices: [
      { text: 'Search the building', loc: 'house',  t: 2, b: 0 },
      { text: 'Check the road',      loc: 'forest', t: 0, b: 2 },
      { text: 'Find a radio',        loc: 'tower',  t: 1, b: 1 } ] },
  { title: 'The First Signal',
    text: 'A radio crackles alive. A voice whispers: “Do not let Mara remember the lake.” Nobody named Mara has mentioned a lake.',
    choices: [
      { text: 'Question everyone',   loc: 'hospital', t: 0, b: 2 },
      { text: 'Follow the signal',   loc: 'tower',    t: 2, b: 0 },
      { text: 'Search for the lake', loc: 'forest',   t: 1, b: 1 } ] },
  { title: 'The Missing Day',
    text: 'You uncover a photograph of the group standing here yesterday. The photograph is dated tomorrow.',
    choices: [
      { text: 'Open the clinic records',     loc: 'hospital', t: 2, b: 0 },
      { text: 'Enter the underground door',  loc: 'facility', t: 1, b: 1 },
      { text: 'Burn the photograph',         loc: 'house',    t: 0, b: 2 } ] },
  { title: 'Under the Settlement',
    text: 'Below the settlement is a room filled with identical backpacks—one for every player. Inside each is a different memory.',
    choices: [
      { text: 'Share all memories',        loc: 'facility', t: 2, b: 1 },
      { text: 'Keep your memory secret',   loc: 'house',    t: 1, b: 0 },
      { text: 'Destroy the room',          loc: 'tower',    t: 0, b: 2 } ] },
  { title: 'The Last Choice',
    text: 'Dawn is close. The radio finally gives clear instructions: “One person must stay. The others can leave.” You have one chance to decide what happens.',
    choices: [
      { text: 'Vote for a sacrifice',  loc: 'forest',   t: 1, b: 0 },
      { text: 'Refuse the sacrifice',  loc: 'facility', t: 1, b: 2 },
      { text: 'Trust the radio',       loc: 'tower',    t: 2, b: 0 } ] }
];

const endings = {
  truth:    { title: 'THE HIDDEN TRUTH', text: 'You found enough of the truth to understand why the settlement remembered you. The road opens at dawn.' },
  bond:     { title: 'SURVIVORS',        text: 'You held each other together. You made it out — the truth is still behind you, waiting.' },
  balanced: { title: 'THE LAST LIGHT',   text: 'You chased answers and kept each other close, but never fully committed to either. The night took more than it gave. But dawn arrived.' }
};

function computeEnding(story) {
  let t = 0, b = 0;
  for (const s of story) { const c = chapters[s.chapter].choices[s.idx]; t += c.t; b += c.b; }
  if (t >= 7) return endings.truth;
  if (b >= 7) return endings.bond;
  return endings.balanced;
}

const publicChapter = i => ({ title: chapters[i].title, text: chapters[i].text, choices: chapters[i].choices.map(c => c.text) });
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const getRoom = socket => rooms.get(socket.data.room);

function publicRoom(r) {
  return {
    code: r.code, solo: r.solo, started: r.started, chapter: r.chapter, host: r.host,
    players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar, host: p.id === r.host }))
  };
}
const emitRoom = r => io.to(r.code).emit('room:update', publicRoom(r));

function freeAvatar(r) {
  const used = new Set([...r.players.values()].map(p => p.avatar));
  return chars.find(c => !used.has(c)) || chars[0];
}
function cleanName(n, fallback) { return String(n || '').trim().slice(0, 18) || fallback; }

// Count votes; advance the story once every connected player has voted.
function checkVotes(r) {
  if (!r.started) return;
  const total = r.players.size, voted = Object.keys(r.votes).length;
  io.to(r.code).emit('game:votes', { count: voted, total });
  if (total === 0 || voted < total) return;

  const ch = chapters[r.chapter];
  const tally = new Array(ch.choices.length).fill(0);
  Object.values(r.votes).forEach(i => tally[i]++);
  const max = Math.max(...tally);
  const top = tally.flatMap((n, i) => (n === max ? [i] : []));
  const idx = top[crypto.randomInt(top.length)];           // ties broken at random
  r.story.push({ chapter: r.chapter, idx });
  r.votes = {};
  r.chapter++;

  if (r.chapter >= chapters.length) {
    r.started = false;
    emitRoom(r);
    io.to(r.code).emit('game:ended', {
      ending: computeEnding(r.story),
      log: r.story.map(s => ({ title: chapters[s.chapter].title, choice: chapters[s.chapter].choices[s.idx].text }))
    });
    return;
  }
  emitRoom(r);
  io.to(r.code).emit('game:event', {
    chapter: r.chapter, total: chapters.length, data: publicChapter(r.chapter),
    location: locations[ch.choices[idx].loc], tie: top.length > 1
  });
}

io.on('connection', socket => {
  socket.on('room:create', ({ name, solo } = {}) => {
    if (socket.data.room) return;
    let c; do c = code(); while (rooms.has(c));
    const r = { code: c, host: socket.id, solo: !!solo, started: false, chapter: 0, story: [], votes: {}, players: new Map() };
    r.players.set(socket.id, { id: socket.id, name: cleanName(name, 'Player'), avatar: chars[0] });
    rooms.set(c, r); socket.data.room = c; socket.join(c);
    socket.emit('room:created', { code: c, solo: r.solo });
    emitRoom(r);
  });

  socket.on('room:join', ({ code: rc, name } = {}) => {
    if (socket.data.room) return;
    const r = rooms.get(String(rc || '').trim().toUpperCase());
    if (!r || r.solo) return socket.emit('error:msg', 'Room not found.');
    if (r.players.size >= MAX_PLAYERS) return socket.emit('error:msg', 'Room is full.');
    if (r.started) return socket.emit('error:msg', 'This story has already started.');
    r.players.set(socket.id, { id: socket.id, name: cleanName(name, `Player ${r.players.size + 1}`), avatar: freeAvatar(r) });
    socket.data.room = r.code; socket.join(r.code);
    socket.emit('room:joined', { code: r.code });
    emitRoom(r);
  });

  socket.on('game:start', () => {
    const r = getRoom(socket);
    if (!r || r.host !== socket.id || r.started) return;
    r.started = true; r.chapter = 0; r.story = []; r.votes = {};
    emitRoom(r);
    io.to(r.code).emit('game:event', { chapter: 0, total: chapters.length, data: publicChapter(0), location: null });
  });

  socket.on('game:choose', ({ choice } = {}) => {
    const r = getRoom(socket);
    if (!r || !r.started || socket.id in r.votes) return;   // one locked-in vote each
    const idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= chapters[r.chapter].choices.length) return;
    r.votes[socket.id] = idx;
    checkVotes(r);
  });

  socket.on('chat:send', ({ text } = {}) => {
    const r = getRoom(socket);
    const msg = String(text || '').trim();
    if (!r || !msg) return;
    const p = r.players.get(socket.id);
    io.to(r.code).emit('chat:message', { id: socket.id, name: p?.name || 'Player', text: msg.slice(0, 400), time: Date.now() });
  });

  // Reserved for future WebRTC voice (signalling only; no audio is routed yet)
  socket.on('voice:signal', ({ to, data } = {}) => io.to(to).emit('voice:signal', { from: socket.id, data }));
  socket.on('voice:ready', () => { const r = getRoom(socket); if (r) socket.to(r.code).emit('voice:peer', { id: socket.id }); });

  socket.on('disconnect', () => {
    const r = getRoom(socket);
    if (!r) return;
    r.players.delete(socket.id);
    delete r.votes[socket.id];
    if (r.players.size === 0) { rooms.delete(r.code); return; }
    if (r.host === socket.id) r.host = r.players.keys().next().value;
    emitRoom(r);
    checkVotes(r);          // a leaver may have been the last missing vote
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Afterlight running on http://localhost:' + PORT));
