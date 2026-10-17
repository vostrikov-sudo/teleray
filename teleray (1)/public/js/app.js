'use strict';

// ─── TRANSLATIONS ────────────────────────────────────────────────
const T = {
  ru:{ chats:'Чаты',search:'Поиск',groups:'Группы',settings:'Настройки',online:'онлайн',offline:'не в сети',typing:'печатает…',you:'Вы',audio_call:'Аудиозвонок',video_call:'Видеозвонок',call_missed:'Пропущенный',call_ended:'Звонок завершён',calling:'Звоним…',incoming_video:'Входящий видеозвонок',incoming_audio:'Входящий аудиозвонок',connected:'Подключено',screen_on:'Показ экрана активен',img_big:'Изображение слишком большое (макс. 5 МБ)',file_big:'Файл слишком большой (макс. 10 МБ)',members:'участников',no_chats:'Нет чатов. Найдите пользователей через поиск.',select_chat:'Выберите чат или найдите пользователя',profile:'Профиль',theme:'Тема',lang:'Язык',logout:'Выйти',light:'Светлая',dark:'Тёмная',open_chat:'Открыть чат',group_members:'Участники'},
  en:{ chats:'Chats',search:'Search',groups:'Groups',settings:'Settings',online:'online',offline:'offline',typing:'typing…',you:'You',audio_call:'Audio call',video_call:'Video call',call_missed:'Missed',call_ended:'Call ended',calling:'Calling…',incoming_video:'Incoming video call',incoming_audio:'Incoming audio call',connected:'Connected',screen_on:'Screen sharing active',img_big:'Image too large (max 5 MB)',file_big:'File too large (max 10 MB)',members:'members',no_chats:'No chats. Find users via search.',select_chat:'Select a chat or find a user',profile:'Profile',theme:'Theme',lang:'Language',logout:'Logout',light:'Light',dark:'Dark',open_chat:'Open chat',group_members:'Members'},
  uk:{ chats:'Чати',search:'Пошук',groups:'Групи',settings:'Налаштування',online:'онлайн',offline:'не в мережі',typing:'друкує…',you:'Ви',audio_call:'Аудіодзвінок',video_call:'Відеодзвінок',call_missed:'Пропущений',call_ended:'Дзвінок завершено',calling:'Дзвонимо…',incoming_video:'Вхідний відеодзвінок',incoming_audio:'Вхідний аудіодзвінок',connected:'Підключено',screen_on:'Демонстрація екрана активна',img_big:'Зображення занадто велике (макс. 5 МБ)',file_big:'Файл занадто великий (макс. 10 МБ)',members:'учасників',no_chats:'Немає чатів. Знайдіть користувачів через пошук.',select_chat:'Оберіть чат або знайдіть користувача',profile:'Профіль',theme:'Тема',lang:'Мова',logout:'Вийти',light:'Світла',dark:'Темна',open_chat:'Відкрити чат',group_members:'Учасники'},
  kk:{ chats:'Чаттар',search:'Іздеу',groups:'Топтар',settings:'Параметрлер',online:'онлайн',offline:'желіде жоқ',typing:'жазып жатыр…',you:'Сіз',audio_call:'Дыбыстық қоңырау',video_call:'Бейнеқоңырау',call_missed:'Өткізіп алды',call_ended:'Қоңырау аяқталды',calling:'Шақырылуда…',incoming_video:'Кіріс бейнеқоңырауы',incoming_audio:'Кіріс дыбыстық қоңырауы',connected:'Қосылды',screen_on:'Экран бөлінуде',img_big:'Сурет тым үлкен (макс. 5 МБ)',file_big:'Файл тым үлкен (макс. 10 МБ)',members:'қатысушы',no_chats:'Чаттар жоқ. Пайдаланушыларды іздеу арқылы табыңыз.',select_chat:'Чат таңдаңыз немесе пайдаланушы табыңыз',profile:'Профиль',theme:'Тақырып',lang:'Тіл',logout:'Шығу',light:'Ашық',dark:'Қараңғы',open_chat:'Чат ашу',group_members:'Қатысушылар'}
};
let lang = localStorage.getItem('tr_lang') || 'ru';
const t = k => (T[lang] || T.ru)[k] || k;

// ─── API LAYER ───────────────────────────────────────────────────
const API = {
  token: localStorage.getItem('tr_token'),
  base: '',
  h() { return { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }; },
  async req(method, url, body) {
    const r = await fetch(this.base + url, { method, headers: this.h(), body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw data;
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b) { return this.req('POST', u, b); },
  patch(u, b) { return this.req('PATCH', u, b); },
  delete(u) { return this.req('DELETE', u); },
};

// ─── STATE ───────────────────────────────────────────────────────
const State = {
  me: null,
  chats: [],         // array of chat objects
  activeChatId: null,
  messages: {},      // chatId -> []
  onlineUsers: new Set(),
  typingTimers: {},  // chatId -> timeout
  typingUsers: {},   // chatId -> Set of usernames
  groupSelected: [], // for create group modal
  ctxMsgId: null,
  ctxChatId: null,
  theme: localStorage.getItem('tr_theme') || 'light',
};

// ─── WEBSOCKET ───────────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;

function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    clearTimeout(wsReconnectTimer);
    if (API.token) ws.send(JSON.stringify({ type: 'auth', token: API.token }));
  };

  ws.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    handleWsMessage(data);
  };

  ws.onerror = () => {};
  ws.onclose = () => {
    wsReconnectTimer = setTimeout(wsConnect, 3000);
  };
}

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'auth_ok':
      break;

    case 'message': {
      const { chatId, message } = data;
      if (!State.messages[chatId]) State.messages[chatId] = [];
      if (!State.messages[chatId].find(m => m.id === message.id)) {
        State.messages[chatId].push(message);
      }
      if (chatId === State.activeChatId) {
        renderMessages(chatId, true);
        API.post(`/api/chats/${chatId}/read`).catch(() => {});
      }
      updateChatInList(chatId, message);
      break;
    }

    case 'message_deleted': {
      const { chatId, msgId } = data;
      if (State.messages[chatId]) {
        State.messages[chatId] = State.messages[chatId].filter(m => m.id !== msgId);
      }
      if (chatId === State.activeChatId) renderMessages(chatId);
      updateChatInList(chatId, null);
      break;
    }

    case 'read': {
      const { chatId, username } = data;
      if (State.messages[chatId]) {
        State.messages[chatId].forEach(m => {
          if (!m.readBy) m.readBy = [];
          if (!m.readBy.includes(username)) m.readBy.push(username);
        });
      }
      if (chatId === State.activeChatId) renderMessages(chatId);
      break;
    }

    case 'typing': {
      const { chatId, username } = data;
      if (username === State.me?.username) return;
      if (!State.typingUsers[chatId]) State.typingUsers[chatId] = new Set();
      State.typingUsers[chatId].add(username);
      clearTimeout(State.typingTimers[chatId + username]);
      State.typingTimers[chatId + username] = setTimeout(() => {
        State.typingUsers[chatId]?.delete(username);
        if (chatId === State.activeChatId) renderTyping(chatId);
      }, 3000);
      if (chatId === State.activeChatId) renderTyping(chatId);
      break;
    }

    case 'user_status': {
      const { username, online } = data;
      if (online) State.onlineUsers.add(username); else State.onlineUsers.delete(username);
      updateUserStatusUI(username, online);
      break;
    }

    case 'user_update': {
      const { user } = data;
      // Update cached user data in chats list
      State.chats.forEach(c => {
        if (c.type === 'direct' && c.peer?.username === user.username) {
          c.peer = user;
        }
      });
      renderChatsList();
      if (State.activeChatId) {
        const chat = State.chats.find(c => c.id === State.activeChatId);
        if (chat && chat.peer?.username === user.username) renderChatHeader(chat);
      }
      break;
    }

    case 'chat_created': {
      const { chat } = data;
      if (!State.chats.find(c => c.id === chat.id)) State.chats.unshift(chat);
      renderChatsList();
      renderGroupsList();
      break;
    }

    case 'chat_updated': {
      const { chatId } = data;
      const c = State.chats.find(c => c.id === chatId);
      if (c) { c.name = data.name || c.name; c.members = data.members || c.members; }
      renderChatsList();
      renderGroupsList();
      break;
    }

    // ─── CALL SIGNALING ────────────────────────────────────────
    case 'call_incoming': Call.onIncoming(data); break;
    case 'call_peer_joined': Call.onPeerJoined(data); break;
    case 'call_peer_left': Call.onPeerLeft(data); break;
    case 'call_offer': Call.onOffer(data); break;
    case 'call_answer': Call.onAnswer(data); break;
    case 'call_ice': Call.onIce(data); break;
    case 'call_rejected': Call.onRejected(data); break;
  }
}

// ─── APP ─────────────────────────────────────────────────────────
const App = {
  async init() {
    App.applyTheme(State.theme);
    App.applyLang(lang);
    if (API.token) {
      try {
        State.me = await API.get('/api/me');
        App.enterApp();
      } catch {
        API.token = null;
        localStorage.removeItem('tr_token');
        App.showAuth();
      }
    } else {
      App.showAuth();
    }

    // Enter key listeners
    document.getElementById('li-pass').onkeydown = e => { if (e.key === 'Enter') App.doLogin(); };
    document.getElementById('rg-pass').onkeydown = e => { if (e.key === 'Enter') App.doRegister(); };

    // Close context menu
    document.addEventListener('click', e => {
      if (!e.target.closest('#ctx-menu')) UI.hideCtx();
    });
  },

  showAuth() { document.getElementById('auth-screen').style.display = 'flex'; },
  hideAuth() { document.getElementById('auth-screen').style.display = 'none'; },

  switchAuthTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-reg').classList.toggle('active', tab === 'reg');
    document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
    document.getElementById('reg-form').style.display = tab === 'reg' ? '' : 'none';
  },

  async doLogin() {
    const username = document.getElementById('li-user').value.trim();
    const password = document.getElementById('li-pass').value;
    document.getElementById('li-err').textContent = '';
    try {
      const data = await API.post('/api/login', { username, password });
      API.token = data.token;
      localStorage.setItem('tr_token', data.token);
      State.me = data.user;
      App.enterApp();
    } catch (e) {
      document.getElementById('li-err').textContent = e.error === 'wrong_credentials' ? 'Неверный логин или пароль' : 'Ошибка входа';
    }
  },

  async doRegister() {
    const name = document.getElementById('rg-name').value.trim();
    const username = document.getElementById('rg-user').value.trim();
    const password = document.getElementById('rg-pass').value;
    document.getElementById('rg-err').textContent = '';
    try {
      const data = await API.post('/api/register', { name, username, password });
      API.token = data.token;
      localStorage.setItem('tr_token', data.token);
      State.me = data.user;
      App.enterApp();
    } catch (e) {
      const msgs = { login_exists: 'Логин уже занят', password_short: 'Пароль слишком короткий', fields_required: 'Заполните все поля', login_invalid: 'Недопустимый логин' };
      document.getElementById('rg-err').textContent = msgs[e.error] || 'Ошибка регистрации';
    }
  },

  logout() {
    API.token = null;
    localStorage.removeItem('tr_token');
    State.me = null;
    State.chats = [];
    State.activeChatId = null;
    if (ws) ws.close();
    document.getElementById('app').classList.add('hidden');
    App.showAuth();
  },

  async enterApp() {
    App.hideAuth();
    document.getElementById('app').classList.remove('hidden');
    App.updateProfileUI();
    await App.loadChats();
    wsConnect();
    App.showPanel('chats');
  },

  updateProfileUI() {
    const u = State.me;
    if (!u) return;
    const av = u.avatar || UI.defaultAvatar(u.name);
    document.getElementById('sidebar-avatar').src = av;
    document.getElementById('settings-avatar').src = av;
    document.getElementById('settings-name').value = u.name;
    document.getElementById('settings-username-hint').textContent = '@' + u.username;
  },

  async loadChats() {
    try {
      State.chats = await API.get('/api/chats');
      renderChatsList();
      renderGroupsList();
      // Update unread badge
      const totalUnread = State.chats.reduce((a, c) => a + (c.unread || 0), 0);
      const badge = document.getElementById('badge-chats');
      badge.textContent = totalUnread > 0 ? totalUnread : '';
      badge.classList.toggle('hidden', totalUnread === 0);
    } catch {}
  },

  showPanel(name) {
    ['chats', 'search', 'groups', 'settings'].forEach(n => {
      document.getElementById('panel-' + n).classList.toggle('hidden', n !== name);
      const btn = document.getElementById('nav-' + n);
      if (btn) btn.classList.toggle('active', n === name);
    });
    if (name !== 'settings') {
      document.getElementById('empty-state').classList.remove('hidden');
    }
  },

  filterChats(q) {
    const items = document.querySelectorAll('#chats-list .chat-item');
    items.forEach(el => {
      const name = el.dataset.name || '';
      el.style.display = name.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  },

  async searchUsers(q) {
    const list = document.getElementById('search-list');
    list.innerHTML = '';
    if (!q.trim()) return;
    try {
      const users = await API.get('/api/users/search?q=' + encodeURIComponent(q));
      if (!users.length) { list.innerHTML = '<p style="padding:16px;color:var(--text3);font-size:13px;text-align:center">Пользователи не найдены</p>'; return; }
      users.forEach(u => {
        const av = u.avatar || UI.defaultAvatar(u.name);
        const div = document.createElement('div');
        div.className = 'sr-item';
        div.innerHTML = `<div class="sr-avatar"><img src="${esc(av)}"></div><div class="sr-info"><div class="sr-name">${esc(u.name)}</div><div class="sr-login">@${esc(u.username)}</div></div><button class="sr-action" onclick="App.openDirectChat('${esc(u.username)}')">Открыть чат</button>`;
        list.appendChild(div);
      });
    } catch {}
  },

  async openDirectChat(peerId) {
    try {
      const chat = await API.post('/api/chats/direct', { peerId });
      // Add or update in state
      const existing = State.chats.find(c => c.id === chat.id);
      if (!existing) State.chats.unshift(chat);
      else Object.assign(existing, chat);
      renderChatsList();
      App.showPanel('chats');
      App.openChat(chat.id);
    } catch {}
  },

  async openChat(chatId) {
    State.activeChatId = chatId;
    const chat = State.chats.find(c => c.id === chatId);
    if (!chat) return;

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('settings-window') && (document.getElementById('settings-window').style.display = '');

    // Load messages if not cached
    if (!State.messages[chatId]) {
      try {
        State.messages[chatId] = await API.get(`/api/chats/${chatId}/messages?limit=50`);
      } catch { State.messages[chatId] = []; }
    }

    renderChatHeader(chat);
    renderMessages(chatId);
    renderChatsList(); // refresh active state

    // Mark read
    API.post(`/api/chats/${chatId}/read`).catch(() => {});
    chat.unread = 0;
    renderChatsList();

    document.getElementById('msg-input').focus();
    renderTyping(chatId);

    // Show/hide members button for groups
    document.getElementById('members-btn').style.display = chat.type === 'group' ? '' : 'none';
  },

  onMsgScroll() {
    // Infinite scroll upward — load more messages
    const area = document.getElementById('messages-area');
    if (area.scrollTop < 60 && State.activeChatId) {
      const msgs = State.messages[State.activeChatId] || [];
      if (msgs.length >= 50) {
        const oldest = msgs[0]?.ts;
        if (oldest && !App._loadingMore) {
          App._loadingMore = true;
          API.get(`/api/chats/${State.activeChatId}/messages?limit=30&before=${oldest}`)
            .then(older => {
              State.messages[State.activeChatId] = [...older, ...State.messages[State.activeChatId]];
              const prevH = area.scrollHeight;
              renderMessages(State.activeChatId, false, true);
              area.scrollTop = area.scrollHeight - prevH;
            })
            .finally(() => { App._loadingMore = false; });
        }
      }
    }
  },

  async send() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !State.activeChatId) return;
    input.value = ''; input.style.height = '';
    try {
      const msg = await API.post(`/api/chats/${State.activeChatId}/messages`, { type: 'text', text });
      if (!State.messages[State.activeChatId]) State.messages[State.activeChatId] = [];
      if (!State.messages[State.activeChatId].find(m => m.id === msg.id)) {
        State.messages[State.activeChatId].push(msg);
      }
      renderMessages(State.activeChatId, true);
      updateChatInList(State.activeChatId, msg);
    } catch {}
  },

  inputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.send(); }
    else App.sendTyping();
  },
  inputChange(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    App.sendTyping();
  },

  _typingTimer: null,
  sendTyping() {
    clearTimeout(App._typingTimer);
    if (!State.activeChatId) return;
    wsSend({ type: 'typing', chatId: State.activeChatId });
    App._typingTimer = setTimeout(() => {}, 2000);
  },

  pickFile() { document.getElementById('file-input').click(); },
  triggerAvatarPick() { document.getElementById('avatar-input').click(); },

  async onFilePick(e) {
    const file = e.target.files[0];
    if (!file || !State.activeChatId) return;
    e.target.value = '';
    const isImg = file.type.startsWith('image/');
    const maxMB = isImg ? 5 : 10;
    if (file.size > maxMB * 1024 * 1024) { alert(t(isImg ? 'img_big' : 'file_big')); return; }
    const data = await readFileB64(file);
    try {
      const msg = await API.post(`/api/chats/${State.activeChatId}/messages`, {
        type: isImg ? 'image' : 'file', data, name: file.name, size: file.size, mimeType: file.type
      });
      if (!State.messages[State.activeChatId]) State.messages[State.activeChatId] = [];
      State.messages[State.activeChatId].push(msg);
      renderMessages(State.activeChatId, true);
      updateChatInList(State.activeChatId, msg);
    } catch {}
  },

  async onAvatarPick(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 5 * 1024 * 1024) { alert(t('img_big')); return; }
    const data = await readFileB64(file);
    try {
      const user = await API.patch('/api/me', { avatar: data });
      State.me = user;
      App.updateProfileUI();
    } catch {}
  },

  async saveProfile() {
    const name = document.getElementById('settings-name').value.trim();
    if (!name) return;
    try {
      const user = await API.patch('/api/me', { name });
      State.me = user;
      App.updateProfileUI();
    } catch {}
  },

  setTheme(theme) {
    State.theme = theme;
    localStorage.setItem('tr_theme', theme);
    App.applyTheme(theme);
  },
  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('tbtn-light')?.classList.toggle('active', theme === 'light');
    document.getElementById('tbtn-dark')?.classList.toggle('active', theme === 'dark');
  },

  setLang(l) {
    lang = l;
    localStorage.setItem('tr_lang', l);
    App.applyLang(l);
  },
  applyLang(l) {
    document.getElementById('lang-select').value = l;
  },

  async createGroup() {
    const name = document.getElementById('cg-name').value.trim();
    if (!name) return;
    const memberIds = State.groupSelected.map(u => u.username);
    if (!memberIds.length) { alert('Добавьте хотя бы одного участника'); return; }
    try {
      const chat = await API.post('/api/chats/group', { name, memberIds });
      State.chats.unshift({ ...chat, unread: 0 });
      renderChatsList();
      renderGroupsList();
      UI.closeCreateGroup();
      App.openChat(chat.id);
      App.showPanel('chats');
    } catch (e) {
      alert(e.error === 'max_10_members' ? 'Максимум 10 участников' : 'Ошибка создания группы');
    }
  },

  contextMsg(msgId, chatId, e) {
    e.preventDefault();
    const msg = (State.messages[chatId] || []).find(m => m.id === msgId);
    if (!msg || msg.from !== State.me?.username) return;
    State.ctxMsgId = msgId;
    State.ctxChatId = chatId;
    const menu = document.getElementById('ctx-menu');
    menu.classList.remove('hidden');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
  },

  async deleteMsg() {
    UI.hideCtx();
    if (!State.ctxMsgId || !State.ctxChatId) return;
    try {
      await API.delete(`/api/chats/${State.ctxChatId}/messages/${State.ctxMsgId}`);
      State.messages[State.ctxChatId] = State.messages[State.ctxChatId].filter(m => m.id !== State.ctxMsgId);
      renderMessages(State.ctxChatId);
      updateChatInList(State.ctxChatId, null);
    } catch {}
  },
};

// ─── UI HELPERS ──────────────────────────────────────────────────
const UI = {
  defaultAvatar(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 80;
    const ctx = canvas.getContext('2d');
    const colors = ['#4f6ef7','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#db2777'];
    ctx.fillStyle = colors[(name || '?').charCodeAt(0) % colors.length];
    ctx.fillRect(0, 0, 80, 80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((name || '?')[0].toUpperCase(), 40, 40);
    return canvas.toDataURL();
  },

  toggleEmoji() { document.getElementById('emoji-panel').classList.toggle('hidden'); },

  toggleMembers() {
    const chat = State.chats.find(c => c.id === State.activeChatId);
    if (!chat) return;
    alert(t('group_members') + ':\n' + (chat.members || []).join(', '));
  },

  showCreateGroup() {
    State.groupSelected = [];
    document.getElementById('cg-name').value = '';
    document.getElementById('cg-search').value = '';
    document.getElementById('cg-search-results').innerHTML = '';
    document.getElementById('cg-selected').innerHTML = '';
    document.getElementById('create-group-modal').classList.remove('hidden');
  },
  closeCreateGroup() { document.getElementById('create-group-modal').classList.add('hidden'); },
  closeModal(e) { if (e.target === document.getElementById('create-group-modal')) UI.closeCreateGroup(); },

  async searchForGroup(q) {
    const list = document.getElementById('cg-search-results');
    list.innerHTML = '';
    if (!q.trim()) return;
    const users = await API.get('/api/users/search?q=' + encodeURIComponent(q)).catch(() => []);
    users.filter(u => !State.groupSelected.find(s => s.username === u.username)).forEach(u => {
      const av = u.avatar || UI.defaultAvatar(u.name);
      const div = document.createElement('div');
      div.className = 'sr-item';
      div.innerHTML = `<div class="sr-avatar"><img src="${esc(av)}"></div><div class="sr-info"><div class="sr-name">${esc(u.name)}</div><div class="sr-login">@${esc(u.username)}</div></div><button class="sr-action" onclick="UI.addToGroup('${esc(u.username)}','${esc(u.name)}','${esc(u.avatar || '')}')">+</button>`;
      list.appendChild(div);
    });
  },

  addToGroup(username, name, avatar) {
    if (State.groupSelected.find(u => u.username === username)) return;
    if (State.groupSelected.length >= 9) { alert('Максимум 9 участников + вы'); return; }
    State.groupSelected.push({ username, name, avatar });
    UI.renderGroupSelected();
    document.getElementById('cg-search').value = '';
    document.getElementById('cg-search-results').innerHTML = '';
  },
  removeFromGroup(username) {
    State.groupSelected = State.groupSelected.filter(u => u.username !== username);
    UI.renderGroupSelected();
  },
  renderGroupSelected() {
    const wrap = document.getElementById('cg-selected');
    wrap.innerHTML = '';
    State.groupSelected.forEach(u => {
      const tag = document.createElement('div');
      tag.className = 'cg-tag';
      tag.innerHTML = `${esc(u.name)} <button onclick="UI.removeFromGroup('${esc(u.username)}')">×</button>`;
      wrap.appendChild(tag);
    });
  },

  openLightbox(src) {
    document.getElementById('lb-img').src = src;
    document.getElementById('lightbox').classList.remove('hidden');
  },
  closeLightbox() { document.getElementById('lightbox').classList.add('hidden'); },
  hideCtx() { document.getElementById('ctx-menu').classList.add('hidden'); },
};

// ─── RENDER FUNCTIONS ────────────────────────────────────────────
function renderChatsList() {
  const list = document.getElementById('chats-list');
  const directs = State.chats.filter(c => c.type === 'direct');
  if (!directs.length) {
    list.innerHTML = `<p style="padding:20px;text-align:center;color:var(--text3);font-size:13px">${t('no_chats')}</p>`;
    return;
  }
  list.innerHTML = '';
  directs.forEach(chat => {
    const peer = chat.peer;
    if (!peer) return;
    const av = peer.avatar || UI.defaultAvatar(peer.name);
    const online = State.onlineUsers.has(peer.username);
    const last = chat.lastMessage;
    let lastText = '';
    if (last) {
      if (last.type === 'text') lastText = (last.from === State.me?.username ? t('you') + ': ' : '') + last.text;
      else if (last.type === 'image') lastText = '🖼️ Фото';
      else if (last.type === 'file') lastText = '📎 ' + (last.name || 'Файл');
      else if (last.type === 'call_log') lastText = last.callType === 'video' ? '📹' : '📞';
    }
    const div = document.createElement('div');
    div.className = 'chat-item' + (State.activeChatId === chat.id ? ' active' : '');
    div.dataset.name = peer.name;
    div.innerHTML = `
      <div class="ci-avatar"><img src="${esc(av)}" alt=""><div class="online-dot${online ? ' show' : ''}" id="dot-${esc(peer.username)}"></div></div>
      <div class="ci-body"><div class="ci-name">${esc(peer.name)}</div><div class="ci-last">${esc(lastText)}</div></div>
      <div class="ci-meta">
        <div class="ci-time">${last ? fmtTime(last.ts) : ''}</div>
        ${chat.unread > 0 ? `<div class="ci-unread">${chat.unread}</div>` : ''}
      </div>`;
    div.onclick = () => App.openChat(chat.id);
    list.appendChild(div);
  });
}

function renderGroupsList() {
  const list = document.getElementById('groups-list');
  const groups = State.chats.filter(c => c.type === 'group');
  if (!groups.length) {
    list.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Нет групп. Создайте группу кнопкой выше.</p>';
    return;
  }
  list.innerHTML = '';
  groups.forEach(chat => {
    const av = chat.avatar || UI.defaultAvatar(chat.name);
    const last = chat.lastMessage;
    let lastText = last ? (last.type === 'text' ? last.text : last.type === 'image' ? '🖼️ Фото' : '📎 Файл') : '';
    const div = document.createElement('div');
    div.className = 'chat-item' + (State.activeChatId === chat.id ? ' active' : '');
    div.dataset.name = chat.name;
    div.innerHTML = `
      <div class="ci-avatar"><img src="${esc(av)}" alt=""></div>
      <div class="ci-body"><div class="ci-name">${esc(chat.name)}</div><div class="ci-last">${esc(lastText)} <span style="color:var(--text3);">${chat.members?.length || 0} уч.</span></div></div>
      <div class="ci-meta">
        <div class="ci-time">${last ? fmtTime(last.ts) : ''}</div>
        ${chat.unread > 0 ? `<div class="ci-unread">${chat.unread}</div>` : ''}
      </div>`;
    div.onclick = () => { App.openChat(chat.id); App.showPanel('chats'); };
    list.appendChild(div);
  });
}

function updateChatInList(chatId, lastMsg) {
  const idx = State.chats.findIndex(c => c.id === chatId);
  if (idx !== -1) {
    if (lastMsg) State.chats[idx].lastMessage = lastMsg;
    if (chatId !== State.activeChatId && lastMsg && lastMsg.from !== State.me?.username) {
      State.chats[idx].unread = (State.chats[idx].unread || 0) + 1;
    }
    // Bubble to top
    const chat = State.chats.splice(idx, 1)[0];
    State.chats.unshift(chat);
  }
  renderChatsList();
  renderGroupsList();
  // Update total badge
  const total = State.chats.reduce((a, c) => a + (c.unread || 0), 0);
  const badge = document.getElementById('badge-chats');
  badge.textContent = total > 0 ? total : '';
  badge.classList.toggle('hidden', total === 0);
}

function renderChatHeader(chat) {
  const isGroup = chat.type === 'group';
  const peer = chat.peer;
  const av = isGroup ? (chat.avatar || UI.defaultAvatar(chat.name)) : (peer?.avatar || UI.defaultAvatar(peer?.name || '?'));
  const name = isGroup ? chat.name : (peer?.name || '');
  const online = isGroup ? false : State.onlineUsers.has(peer?.username);
  const status = isGroup ? `${chat.members?.length || 0} ${t('members')}` : (online ? t('online') : t('offline'));
  document.getElementById('ch-avatar').src = av;
  document.getElementById('ch-name').textContent = name;
  document.getElementById('ch-status').textContent = status;
}

function renderMessages(chatId, scrollToBottom = false, preserveScroll = false) {
  const area = document.getElementById('messages-area');
  const msgs = State.messages[chatId] || [];
  if (!msgs.length) { area.innerHTML = ''; return; }

  let lastDate = '';
  let lastFrom = '';
  const html = msgs.map((msg, i) => {
    const isMe = msg.from === State.me?.username;
    const chat = State.chats.find(c => c.id === chatId);
    const isGroup = chat?.type === 'group';
    const d = new Date(msg.ts);
    const dateStr = d.toLocaleDateString(lang, { day: 'numeric', month: 'long' });
    let out = '';
    if (dateStr !== lastDate) { out += `<div class="date-sep">${esc(dateStr)}</div>`; lastDate = dateStr; lastFrom = ''; }

    const sameAuthor = msg.from === lastFrom;
    lastFrom = msg.from;

    // Find sender info
    let senderName = '';
    if (isGroup && !isMe) {
      if (!sameAuthor) {
        const peer = chat?.members ? null : null;
        senderName = msg.from; // fallback to username
      }
    }

    const av = (() => {
      if (isMe) return State.me?.avatar || UI.defaultAvatar(State.me?.name || '?');
      const peerChat = State.chats.find(c => c.id === chatId);
      if (peerChat?.peer) return peerChat.peer.avatar || UI.defaultAvatar(peerChat.peer.name);
      return UI.defaultAvatar(msg.from);
    })();

    let bubble = '';
    if (msg.type === 'text') {
      const isEmoji = /^[\p{Emoji}\s]{1,4}$/u.test(msg.text) && msg.text.trim().length <= 8;
      bubble = `<div class="msg-bubble${isEmoji ? ' emoji-only' : ''}">${isGroup && !isMe && !sameAuthor ? `<div class="msg-sender">${esc(msg.from)}</div>` : ''}${esc(msg.text).replace(/\n/g, '<br>')}</div>`;
    } else if (msg.type === 'image') {
      if (msg.expired || !msg.data) {
        bubble = `<div class="msg-bubble" style="color:var(--text3);font-size:12px">🖼️ Фото удалено (24ч)</div>`;
      } else {
        bubble = `<div class="msg-bubble" style="padding:5px"><img class="msg-img" src="${esc(msg.data)}" alt="photo" onclick="UI.openLightbox(this.src)"></div>`;
      }
    } else if (msg.type === 'file') {
      const icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
      bubble = `<div class="msg-bubble"><div class="msg-file"><div class="msg-file-icon">${icon}</div><div class="msg-file-info"><div class="msg-file-name">${esc(msg.name || 'file')}</div><div class="msg-file-size">${fmtSize(msg.size)}</div></div></div></div>`;
    } else if (msg.type === 'call_log') {
      const ico = msg.callType === 'video' ? '📹' : '📞';
      bubble = `<div class="msg-bubble"><div class="msg-call">${ico} ${esc(msg.text || '')}</div></div>`;
    }

    const avatarHtml = `<div class="msg-avatar-wrap${sameAuthor && !isGroup ? ' invisible' : ''}"><img src="${esc(av)}" alt=""></div>`;
    const deleteBtn = isMe ? `<button class="msg-delete-btn" onclick="App.contextMsg('${esc(msg.id)}','${esc(chatId)}',event)" title="Удалить">🗑</button>` : '';

    return `<div class="msg-row ${isMe ? 'out' : 'in'}${sameAuthor ? ' same' : ''}" id="msg-${esc(msg.id)}">
      ${!isMe ? avatarHtml : ''}
      <div class="msg-body">
        ${bubble}
        <div class="msg-meta">
          <span class="msg-time">${fmtTime(msg.ts)}</span>
          ${isMe ? '<span class="msg-ticks">✓✓</span>' : ''}
        </div>
      </div>
      ${isMe ? avatarHtml : ''}
      ${deleteBtn}
    </div>`;
  }).join('');

  area.innerHTML = html;
  if (scrollToBottom || !preserveScroll) area.scrollTop = area.scrollHeight;
}

function renderTyping(chatId) {
  const el = document.getElementById('typing-indicator');
  const users = State.typingUsers[chatId];
  if (users && users.size > 0) {
    el.textContent = [...users].join(', ') + ' ' + t('typing');
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function updateUserStatusUI(username, online) {
  const dot = document.getElementById('dot-' + username);
  if (dot) dot.classList.toggle('show', online);
  // If in active direct chat with this user
  const chat = State.chats.find(c => c.type === 'direct' && c.peer?.username === username);
  if (chat && chat.id === State.activeChatId) {
    document.getElementById('ch-status').textContent = online ? t('online') : t('offline');
  }
}

// ─── CALL MODULE ─────────────────────────────────────────────────
const Call = {
  callId: null,
  chatId: null,
  callType: 'video',
  peers: {},        // peerId -> RTCPeerConnection
  localStream: null,
  screenStream: null,
  micOn: true,
  camOn: true,
  timerInterval: null,
  timerSeconds: 0,
  pendingCallData: null, // for incoming call

  ICE: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },

  async start(type) {
    if (!State.activeChatId) return;
    const chat = State.chats.find(c => c.id === State.activeChatId);
    if (!chat) return;

    Call.callType = type;
    Call.chatId = State.activeChatId;
    Call.callId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2);

    try {
      Call.localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
    } catch (e) {
      alert('Нет доступа к камере/микрофону: ' + e.message);
      return;
    }

    document.getElementById('local-video').srcObject = Call.localStream;
    Call.showOverlay(chat.type === 'group' ? chat.name : chat.peer?.name || '?', type);
    document.getElementById('call-status-txt').textContent = t('calling');

    // Invite all chat members
    wsSend({ type: 'call_invite', callId: Call.callId, chatId: Call.chatId, callType: type });
  },

  showOverlay(name, type) {
    document.getElementById('call-name').textContent = name;
    document.getElementById('call-overlay').classList.remove('hidden');
    document.getElementById('call-peers-grid').innerHTML = '';
    Call.micOn = true; Call.camOn = true;
    Call.updateCtrlButtons();
    document.getElementById('call-timer').classList.add('hidden');
    document.getElementById('screen-banner').classList.add('hidden');
  },

  onIncoming(data) {
    Call.pendingCallData = data;
    const { from, callType, chatId } = data;
    // Determine display name
    const chat = State.chats.find(c => c.id === chatId);
    const peer = chat?.peer;
    const av = peer?.avatar || UI.defaultAvatar(peer?.name || from);
    document.getElementById('inc-avatar').src = av;
    document.getElementById('inc-name').textContent = peer?.name || from;
    document.getElementById('inc-type').textContent = t(callType === 'video' ? 'incoming_video' : 'incoming_audio');
    document.getElementById('incoming-call').classList.remove('hidden');
  },

  async accept() {
    document.getElementById('incoming-call').classList.add('hidden');
    const data = Call.pendingCallData;
    if (!data) return;
    Call.callId = data.callId;
    Call.chatId = data.chatId;
    Call.callType = data.callType || 'video';

    try {
      Call.localStream = await navigator.mediaDevices.getUserMedia({ video: Call.callType === 'video', audio: true });
    } catch (e) { alert('Нет доступа к медиа: ' + e.message); return; }

    document.getElementById('local-video').srcObject = Call.localStream;
    const chat = State.chats.find(c => c.id === Call.chatId);
    Call.showOverlay(chat?.peer?.name || chat?.name || '?', Call.callType);
    document.getElementById('call-status-txt').textContent = t('connected');
    Call.startTimer();

    // Join the call
    wsSend({ type: 'call_invite', callId: Call.callId, chatId: Call.chatId, callType: Call.callType });
  },

  reject() {
    document.getElementById('incoming-call').classList.add('hidden');
    if (Call.pendingCallData) {
      wsSend({ type: 'call_reject', callId: Call.pendingCallData.callId });
    }
    Call.pendingCallData = null;
  },

  end() {
    wsSend({ type: 'call_end', callId: Call.callId });
    Call._cleanup();
    // Log call
    if (Call.chatId && Call.timerSeconds > 0) {
      const dur = fmtDuration(Call.timerSeconds);
      API.post(`/api/chats/${Call.chatId}/messages`, {
        type: 'call_log', callType: Call.callType,
        text: (Call.callType === 'video' ? t('video_call') : t('audio_call')) + ' ' + dur,
        duration: Call.timerSeconds,
      }).catch(() => {});
    }
  },

  _cleanup() {
    clearInterval(Call.timerInterval);
    if (Call.localStream) { Call.localStream.getTracks().forEach(t => t.stop()); Call.localStream = null; }
    if (Call.screenStream) { Call.screenStream.getTracks().forEach(t => t.stop()); Call.screenStream = null; }
    for (const pc of Object.values(Call.peers)) try { pc.close(); } catch {}
    Call.peers = {};
    document.getElementById('call-overlay').classList.add('hidden');
    document.getElementById('call-peers-grid').innerHTML = '';
    document.getElementById('local-video').srcObject = null;
    Call.callId = null; Call.callType = 'video'; Call.timerSeconds = 0;
  },

  // Mesh: when server tells us a new peer joined, create PC for them
  async onPeerJoined({ callId, peerId }) {
    if (callId !== Call.callId || peerId === State.me?.username) return;
    if (Call.peers[peerId]) return; // already have connection
    const pc = Call._createPC(peerId);
    Call.peers[peerId] = pc;
    // Add local tracks
    if (Call.localStream) Call.localStream.getTracks().forEach(t => pc.addTrack(t, Call.localStream));
    // Create video element for this peer
    Call._addPeerVideo(peerId);
    // Initiator creates offer to the new peer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ type: 'call_offer', callId: Call.callId, to: peerId, sdp: pc.localDescription });
    document.getElementById('call-status-txt').textContent = t('connected');
    Call.startTimer();
  },

  async onOffer({ callId, from, sdp }) {
    if (callId !== Call.callId) return;
    let pc = Call.peers[from];
    if (!pc) {
      pc = Call._createPC(from);
      Call.peers[from] = pc;
      if (Call.localStream) Call.localStream.getTracks().forEach(t => pc.addTrack(t, Call.localStream));
      Call._addPeerVideo(from);
    }
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsSend({ type: 'call_answer', callId: Call.callId, to: from, sdp: pc.localDescription });
    document.getElementById('call-status-txt').textContent = t('connected');
    Call.startTimer();
  },

  async onAnswer({ callId, from, sdp }) {
    if (callId !== Call.callId) return;
    const pc = Call.peers[from];
    if (pc && pc.signalingState !== 'stable') await pc.setRemoteDescription(sdp);
  },

  async onIce({ callId, from, candidate }) {
    if (callId !== Call.callId) return;
    const pc = Call.peers[from];
    if (pc && candidate) try { await pc.addIceCandidate(candidate); } catch {}
  },

  onPeerLeft({ callId, peerId }) {
    if (callId !== Call.callId) return;
    const pc = Call.peers[peerId];
    if (pc) { try { pc.close(); } catch {} delete Call.peers[peerId]; }
    const vid = document.getElementById('pv-' + peerId);
    if (vid) vid.parentElement.remove();
  },

  onRejected({ callId }) {
    if (callId !== Call.callId) return;
    document.getElementById('call-status-txt').textContent = 'Отклонён';
    setTimeout(() => Call._cleanup(), 1500);
  },

  _createPC(peerId) {
    const pc = new RTCPeerConnection(Call.ICE);
    pc.onicecandidate = e => {
      if (e.candidate) wsSend({ type: 'call_ice', callId: Call.callId, to: peerId, candidate: e.candidate });
    };
    pc.ontrack = e => {
      let vid = document.getElementById('pv-' + peerId);
      if (!vid) { Call._addPeerVideo(peerId); vid = document.getElementById('pv-' + peerId); }
      if (vid) { if (!vid.srcObject) vid.srcObject = new MediaStream(); vid.srcObject.addTrack(e.track); }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        Call.onPeerLeft({ callId: Call.callId, peerId });
      }
    };
    return pc;
  },

  _addPeerVideo(peerId) {
    const grid = document.getElementById('call-peers-grid');
    if (document.getElementById('pv-' + peerId)) return;
    const wrap = document.createElement('div');
    wrap.className = 'peer-video-wrap';
    wrap.innerHTML = `<video id="pv-${esc(peerId)}" autoplay playsinline></video><div class="peer-video-label">${esc(peerId)}</div>`;
    grid.appendChild(wrap);
  },

  toggleMic() {
    Call.micOn = !Call.micOn;
    if (Call.localStream) Call.localStream.getAudioTracks().forEach(t => t.enabled = Call.micOn);
    Call.updateCtrlButtons();
  },
  toggleCam() {
    Call.camOn = !Call.camOn;
    if (Call.localStream) Call.localStream.getVideoTracks().forEach(t => t.enabled = Call.camOn);
    Call.updateCtrlButtons();
  },
  async toggleScreen() {
    if (!Call.screenStream) {
      try {
        Call.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const track = Call.screenStream.getVideoTracks()[0];
        for (const pc of Object.values(Call.peers)) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(track);
        }
        document.getElementById('local-video').srcObject = Call.screenStream;
        document.getElementById('screen-banner').classList.remove('hidden');
        track.onended = () => Call.stopScreen();
      } catch {}
    } else { Call.stopScreen(); }
    Call.updateCtrlButtons();
  },
  stopScreen() {
    if (Call.screenStream) { Call.screenStream.getTracks().forEach(t => t.stop()); Call.screenStream = null; }
    if (Call.localStream) {
      const vt = Call.localStream.getVideoTracks()[0];
      for (const pc of Object.values(Call.peers)) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && vt) sender.replaceTrack(vt);
      }
      document.getElementById('local-video').srcObject = Call.localStream;
    }
    document.getElementById('screen-banner').classList.add('hidden');
    Call.updateCtrlButtons();
  },
  updateCtrlButtons() {
    document.getElementById('ctrl-mic').textContent = Call.micOn ? '🎤' : '🔇';
    document.getElementById('ctrl-mic').classList.toggle('off', !Call.micOn);
    document.getElementById('ctrl-cam').textContent = Call.camOn ? '📷' : '🚫';
    document.getElementById('ctrl-cam').classList.toggle('off', !Call.camOn);
    document.getElementById('ctrl-screen').classList.toggle('off', !!Call.screenStream);
  },

  startTimer() {
    if (Call.timerInterval) return;
    Call.timerSeconds = 0;
    const el = document.getElementById('call-timer');
    el.classList.remove('hidden');
    Call.timerInterval = setInterval(() => {
      Call.timerSeconds++;
      el.textContent = fmtDuration(Call.timerSeconds);
    }, 1000);
  },
};

// ─── EMOJI SETUP ─────────────────────────────────────────────────
const EMOJIS = ['😀','😂','🥰','😍','😎','🤔','😢','😡','🎉','👍','👎','❤️','🔥','✨','💯','🙏','👋','🤝','💪','🎶','🍕','☕','🌟','💬','🚀','😊','🤣','😇','🥳','😏','🤗','😴','🤩','🥺','😱','🤦','🤷','👏','🎊','💎'];
(function buildEmoji() {
  const panel = document.getElementById('emoji-panel');
  if (!panel) return;
  EMOJIS.forEach(em => {
    const b = document.createElement('span');
    b.className = 'ep-btn'; b.textContent = em;
    b.onclick = () => {
      const inp = document.getElementById('msg-input');
      inp.value += em; inp.focus(); App.inputChange(inp);
    };
    panel.appendChild(b);
  });
})();

// ─── UTILS ───────────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtSize(b) { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b/1024).toFixed(1) + ' KB'; return (b/1048576).toFixed(1) + ' MB'; }
function fmtDuration(s) { return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); }
function readFileB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file); }); }

// ─── BOOT ────────────────────────────────────────────────────────
App.init();
