const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const JWT_SECRET = process.env.JWT_SECRET || 'teleray_secret_key_change_in_prod';
const PORT = process.env.PORT || 3000;
const MAX_IMAGE_MB = 5;
const MAX_FILE_MB = 10;
const FILE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ─── IN-MEMORY DATABASE ─────────────────────────────────────────
// In production replace with SQLite/Postgres
const DB = {
  users: {},      // { username: { name, passwordHash, avatar, createdAt } }
  chats: {},      // { chatId: { type:'direct'|'group', name?, members:[], messages:[], createdBy?, avatar? } }
  sessions: {}    // { token: username }
};

// ─── HELPERS ────────────────────────────────────────────────────
function chatId(a, b) { return [a, b].sort().join('__'); }
function groupChatId() { return 'group__' + uuidv4(); }

function userPublic(username) {
  const u = DB.users[username];
  if (!u) return null;
  return { username, name: u.name, avatar: u.avatar || '', online: isOnline(username) };
}

const clients = new Map(); // username -> Set<ws>

function isOnline(username) { return clients.has(username) && clients.get(username).size > 0; }

function sendTo(username, data) {
  const sockets = clients.get(username);
  if (!sockets) return;
  const msg = JSON.stringify(data);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function broadcastToChat(chatId, data, excludeUser = null) {
  const chat = DB.chats[chatId];
  if (!chat) return;
  for (const member of chat.members) {
    if (member !== excludeUser) sendTo(member, data);
  }
}

function authWs(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (DB.users[payload.username]) return payload.username;
  } catch {}
  return null;
}

function authHttp(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return DB.users[p.username] ? p.username : null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = authHttp(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.username = user;
  next();
}

// Clean expired file/image data older than 24h (keep metadata)
function cleanExpiredFiles() {
  const now = Date.now();
  for (const chat of Object.values(DB.chats)) {
    for (const msg of chat.messages) {
      if ((msg.type === 'image' || msg.type === 'file') && now - msg.ts > FILE_EXPIRY_MS) {
        if (msg.data) { msg.data = null; msg.expired = true; }
      }
    }
  }
}
setInterval(cleanExpiredFiles, 60 * 60 * 1000);

// ─── AUTH ROUTES ────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'fields_required' });
  if (password.length < 6) return res.status(400).json({ error: 'password_short' });
  const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (clean.length < 2) return res.status(400).json({ error: 'login_invalid' });
  if (DB.users[clean]) return res.status(409).json({ error: 'login_exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  DB.users[clean] = { name: name.trim(), passwordHash, avatar: '', createdAt: Date.now() };
  const token = jwt.sign({ username: clean }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: userPublic(clean) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const clean = (username || '').toLowerCase().trim();
  const u = DB.users[clean];
  if (!u) return res.status(401).json({ error: 'wrong_credentials' });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: 'wrong_credentials' });
  const token = jwt.sign({ username: clean }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: userPublic(clean) });
});

// ─── USER ROUTES ────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  res.json(userPublic(req.username));
});

app.patch('/api/me', requireAuth, (req, res) => {
  const { name, avatar } = req.body;
  const u = DB.users[req.username];
  if (name) u.name = name.trim().slice(0, 60);
  if (avatar !== undefined) {
    // Validate base64 image size (~5MB base64 = ~3.7MB)
    if (avatar && avatar.length > 7 * 1024 * 1024) return res.status(413).json({ error: 'avatar_too_large' });
    u.avatar = avatar;
  }
  // Broadcast profile update to all chats the user is in
  for (const [cid, chat] of Object.entries(DB.chats)) {
    if (chat.members.includes(req.username)) {
      broadcastToChat(cid, { type: 'user_update', user: userPublic(req.username) }, req.username);
    }
  }
  res.json(userPublic(req.username));
});

app.get('/api/users/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = Object.keys(DB.users)
    .filter(u => u !== req.username && (u.includes(q) || DB.users[u].name.toLowerCase().includes(q)))
    .slice(0, 20)
    .map(u => userPublic(u));
  res.json(results);
});

app.get('/api/users/:username', requireAuth, (req, res) => {
  const u = userPublic(req.params.username);
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json(u);
});

// ─── CHAT ROUTES ────────────────────────────────────────────────
app.get('/api/chats', requireAuth, (req, res) => {
  const mine = Object.entries(DB.chats)
    .filter(([, c]) => c.members.includes(req.username))
    .map(([id, c]) => {
      const msgs = c.messages;
      const last = msgs[msgs.length - 1] || null;
      const unread = msgs.filter(m => m.from !== req.username && !(m.readBy || []).includes(req.username)).length;
      let chatInfo = { id, type: c.type, members: c.members, name: c.name, avatar: c.avatar, unread, lastMessage: last };
      if (c.type === 'direct') {
        const peer = c.members.find(m => m !== req.username);
        chatInfo.peer = userPublic(peer);
      }
      return chatInfo;
    })
    .sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
  res.json(mine);
});

app.post('/api/chats/direct', requireAuth, (req, res) => {
  const { peerId } = req.body;
  if (!DB.users[peerId]) return res.status(404).json({ error: 'user_not_found' });
  const cid = chatId(req.username, peerId);
  if (!DB.chats[cid]) {
    DB.chats[cid] = { type: 'direct', members: [req.username, peerId], messages: [], createdAt: Date.now() };
  }
  const c = DB.chats[cid];
  const last = c.messages[c.messages.length - 1] || null;
  const unread = c.messages.filter(m => m.from !== req.username && !(m.readBy || []).includes(req.username)).length;
  res.json({ id: cid, type: 'direct', members: c.members, peer: userPublic(peerId), unread, lastMessage: last });
});

app.post('/api/chats/group', requireAuth, (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !memberIds || !Array.isArray(memberIds)) return res.status(400).json({ error: 'fields_required' });
  const members = [...new Set([req.username, ...memberIds.filter(m => DB.users[m])])];
  if (members.length < 2) return res.status(400).json({ error: 'need_members' });
  if (members.length > 10) return res.status(400).json({ error: 'max_10_members' });
  const cid = groupChatId();
  DB.chats[cid] = { type: 'group', name: name.trim().slice(0, 60), members, messages: [], createdBy: req.username, avatar: '', createdAt: Date.now() };
  const chat = DB.chats[cid];
  const result = { id: cid, type: 'group', name: chat.name, members, unread: 0, lastMessage: null };
  // Notify all members
  for (const m of members) {
    if (m !== req.username) sendTo(m, { type: 'chat_created', chat: result });
  }
  res.json(result);
});

app.patch('/api/chats/:chatId', requireAuth, (req, res) => {
  const chat = DB.chats[req.params.chatId];
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!chat.members.includes(req.username)) return res.status(403).json({ error: 'forbidden' });
  if (chat.type !== 'group') return res.status(400).json({ error: 'not_group' });
  const { name, avatar, addMembers, removeMembers } = req.body;
  if (name) chat.name = name.trim().slice(0, 60);
  if (avatar !== undefined) chat.avatar = avatar;
  if (addMembers && Array.isArray(addMembers)) {
    for (const m of addMembers) {
      if (DB.users[m] && !chat.members.includes(m) && chat.members.length < 10) chat.members.push(m);
    }
  }
  if (removeMembers && Array.isArray(removeMembers) && chat.createdBy === req.username) {
    chat.members = chat.members.filter(m => !removeMembers.includes(m) || m === req.username);
  }
  broadcastToChat(req.params.chatId, { type: 'chat_updated', chatId: req.params.chatId, name: chat.name, avatar: chat.avatar, members: chat.members });
  res.json({ id: req.params.chatId, ...chat });
});

// ─── MESSAGES ────────────────────────────────────────────────────
app.get('/api/chats/:chatId/messages', requireAuth, (req, res) => {
  const chat = DB.chats[req.params.chatId];
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!chat.members.includes(req.username)) return res.status(403).json({ error: 'forbidden' });
  const limit = parseInt(req.query.limit) || 50;
  const before = parseInt(req.query.before) || Date.now() + 1;
  const msgs = chat.messages.filter(m => m.ts < before).slice(-limit);
  // Strip expired file data
  const safe = msgs.map(m => m.expired ? { ...m, data: null } : m);
  res.json(safe);
});

app.post('/api/chats/:chatId/messages', requireAuth, (req, res) => {
  const chat = DB.chats[req.params.chatId];
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!chat.members.includes(req.username)) return res.status(403).json({ error: 'forbidden' });
  const { type, text, data, name: fileName, size, mimeType } = req.body;
  if (!type) return res.status(400).json({ error: 'type_required' });

  // Size validation
  if (type === 'image' && data && data.length > (MAX_IMAGE_MB + 1) * 1024 * 1024 * 1.4)
    return res.status(413).json({ error: 'image_too_large' });
  if (type === 'file' && data && data.length > (MAX_FILE_MB + 1) * 1024 * 1024 * 1.4)
    return res.status(413).json({ error: 'file_too_large' });

  const msg = { id: uuidv4(), type, from: req.username, ts: Date.now(), readBy: [req.username] };
  if (type === 'text') msg.text = (text || '').slice(0, 4000);
  if (type === 'image') { msg.data = data; }
  if (type === 'file') { msg.data = data; msg.name = fileName; msg.size = size; msg.mimeType = mimeType; }
  if (type === 'call_log') { msg.text = text; msg.callType = req.body.callType; msg.duration = req.body.duration; }

  chat.messages.push(msg);

  const payload = { type: 'message', chatId: req.params.chatId, message: type === 'file' || type === 'image' ? { ...msg } : msg };
  broadcastToChat(req.params.chatId, payload, req.username);
  res.json(msg);
});

app.delete('/api/chats/:chatId/messages/:msgId', requireAuth, (req, res) => {
  const chat = DB.chats[req.params.chatId];
  if (!chat) return res.status(404).json({ error: 'not_found' });
  if (!chat.members.includes(req.username)) return res.status(403).json({ error: 'forbidden' });
  const idx = chat.messages.findIndex(m => m.id === req.params.msgId);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const msg = chat.messages[idx];
  if (msg.from !== req.username) return res.status(403).json({ error: 'not_yours' });
  chat.messages.splice(idx, 1);
  broadcastToChat(req.params.chatId, { type: 'message_deleted', chatId: req.params.chatId, msgId: req.params.msgId });
  res.json({ ok: true });
});

app.post('/api/chats/:chatId/read', requireAuth, (req, res) => {
  const chat = DB.chats[req.params.chatId];
  if (!chat || !chat.members.includes(req.username)) return res.status(403).json({ error: 'forbidden' });
  for (const m of chat.messages) {
    if (!(m.readBy || []).includes(req.username)) {
      m.readBy = m.readBy || [];
      m.readBy.push(req.username);
    }
  }
  broadcastToChat(req.params.chatId, { type: 'read', chatId: req.params.chatId, username: req.username });
  res.json({ ok: true });
});

// ─── WEBSOCKET ──────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    // Auth handshake
    if (data.type === 'auth') {
      const u = authWs(data.token);
      if (!u) { ws.send(JSON.stringify({ type: 'auth_error' })); return; }
      username = u;
      if (!clients.has(username)) clients.set(username, new Set());
      clients.get(username).add(ws);
      ws.send(JSON.stringify({ type: 'auth_ok', username }));
      // Notify contacts that user came online
      broadcastOnlineStatus(username, true);
      return;
    }

    if (!username) return;

    // Typing indicator
    if (data.type === 'typing') {
      const chat = DB.chats[data.chatId];
      if (chat && chat.members.includes(username)) {
        broadcastToChat(data.chatId, { type: 'typing', chatId: data.chatId, username }, username);
      }
      return;
    }

    // WebRTC signaling
    if (['call_offer', 'call_answer', 'call_ice', 'call_reject', 'call_end', 'call_invite'].includes(data.type)) {
      handleCallSignal(username, data);
      return;
    }
  });

  ws.on('close', () => {
    if (!username) return;
    const set = clients.get(username);
    if (set) { set.delete(ws); if (set.size === 0) clients.delete(username); }
    broadcastOnlineStatus(username, false);
  });
});

function broadcastOnlineStatus(username, online) {
  for (const [cid, chat] of Object.entries(DB.chats)) {
    if (chat.members.includes(username)) {
      broadcastToChat(cid, { type: 'user_status', username, online }, username);
    }
  }
}

// ─── CALL SIGNALING ─────────────────────────────────────────────
// Active calls: { callId: { chatId, initiator, type, participants: Set, offers: {}, answers: {}, ices: {} } }
const activeCalls = new Map();

function handleCallSignal(from, data) {
  const { callId, chatId, callType, to, sdp, candidate } = data;

  if (data.type === 'call_invite') {
    // Start or join a call
    let call = activeCalls.get(callId);
    if (!call) {
      const chat = DB.chats[chatId];
      if (!chat || !chat.members.includes(from)) return;
      call = { callId, chatId, callType: callType || 'video', initiator: from, participants: new Set([from]), offers: {}, answers: {}, ices: {} };
      activeCalls.set(callId, call);
    }
    call.participants.add(from);
    // Notify all chat members about the call
    const chat = DB.chats[chatId];
    if (chat) {
      for (const member of chat.members) {
        if (!call.participants.has(member)) {
          sendTo(member, { type: 'call_incoming', callId, chatId, from, callType: call.callType });
        }
      }
    }
    // Tell existing participants about the new joiner (for mesh)
    for (const participant of call.participants) {
      if (participant !== from) {
        sendTo(participant, { type: 'call_peer_joined', callId, peerId: from });
        sendTo(from, { type: 'call_peer_joined', callId, peerId: participant });
      }
    }
    return;
  }

  if (data.type === 'call_offer') {
    sendTo(to, { type: 'call_offer', callId, from, sdp });
    return;
  }

  if (data.type === 'call_answer') {
    sendTo(to, { type: 'call_answer', callId, from, sdp });
    return;
  }

  if (data.type === 'call_ice') {
    sendTo(to, { type: 'call_ice', callId, from, candidate });
    return;
  }

  if (data.type === 'call_reject') {
    const call = activeCalls.get(callId);
    if (call) {
      sendTo(call.initiator, { type: 'call_rejected', callId, from });
    }
    return;
  }

  if (data.type === 'call_end') {
    const call = activeCalls.get(callId);
    if (call) {
      call.participants.delete(from);
      for (const p of call.participants) {
        sendTo(p, { type: 'call_peer_left', callId, peerId: from });
      }
      if (call.participants.size === 0) activeCalls.delete(callId);
    }
    return;
  }
}

// ─── START ──────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`TeleRay server running on http://localhost:${PORT}`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);

  // Seed demo users
  const demos = [
    { username: 'alex', name: 'Алекс Иванов', password: 'demo123' },
    { username: 'maria', name: 'Мария Петрова', password: 'demo123' },
    { username: 'ivan', name: 'Иван Смирнов', password: 'demo123' },
  ];
  Promise.all(demos.map(async d => {
    if (!DB.users[d.username]) {
      DB.users[d.username] = { name: d.name, passwordHash: await bcrypt.hash(d.password, 10), avatar: '', createdAt: Date.now() };
    }
  })).then(() => console.log('Demo users ready: alex, maria, ivan / demo123'));
});
