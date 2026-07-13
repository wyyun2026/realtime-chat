/* ============================================================
 *  Slack 风格群聊 · 匿名树洞  —  Supabase Realtime 前端逻辑
 *  使用 Supabase JS v2 (Postgres Changes + Presence + Broadcast)
 * ============================================================ */

/* ============ 配置区 ============ */
// 替换为你自己的 Supabase 项目 URL 和 publishable key
const SUPABASE_URL   = 'https://ziqlqljdsubhhlnmazde.supabase.co';
const SUPABASE_ANON  = 'sb_publishable_MIOJ9YOHi0ZPtFprL65IFg_JlzLj0wN';

/* ============ 常量 ============ */
const AVATAR_COLORS = [
  '#611f69','#e01e5a','#2eb67d','#f2c744','#36c5f0',
  '#ecb22e','#e5322d','#7b68ee','#ff7f50','#40e0d0',
  '#da70d6','#ff6347','#4682b4','#32cd99','#ff69b4'
];

const EMOJIS = [
  '😀','😂','🥰','😎','🤔','😴','😭','😡',
  '👍','👎','👏','🙏','💪','🎉','🔥','💯',
  '❤️','💔','✨','⚡','🚀','☕','🍕','🍺',
  '👀','💀','🤡','👻','🤖','🌈','⭐','💎'
];

const QUICK_REACTIONS = ['👍','❤️','😂','🎉','🔥','👀'];

/* ============ 全局状态 ============ */
const state = {
  supabase: null,
  user: { id: '', name: '', color: '#611f69' },
  channels: [],
  currentChannel: null,
  messages: [],          // 当前频道消息 {id, channel_id, user_id, username, avatar_color, content, is_anon, created_at, reactions:{}}
  messageEls: new Map(), // id -> DOM element
  presenceChannel: null,
  dbChannel: null,       // realtime subscription for messages
  reactionChannel: null, // realtime subscription for reactions
  typingTimer: null,
  isTyping: false,
  lastAuthor: null,
  lastDateStr: null,
};

/* ============ DOM 引用 ============ */
const $ = (id) => document.getElementById(id);
const dom = {
  modeSelector:  $('modeSelector'),
  modeLanBtn:    $('modeLanBtn'),
  modeCloudBtn:  $('modeCloudBtn'),
  loginModal:    $('loginModal'),
  nicknameInput: $('nicknameInput'),
  colorSwatches: $('colorSwatches'),
  joinBtn:       $('joinBtn'),
  app:           $('app'),
  sidebar:       $('sidebar'),
  sidebarOverlay:$('sidebarOverlay'),
  mobileMenuBtn: $('mobileMenuBtn'),
  channelList:   $('channelList'),
  memberList:    $('memberList'),
  onlineCount:   $('onlineCount'),
  meAvatar:      $('meAvatar'),
  meName:        $('meName'),
  chHash:        $('chHash'),
  chName:        $('chName'),
  chDesc:        $('chDesc'),
  chMembers:     $('chMembers'),
  messages:      $('messages'),
  messageInput:  $('messageInput'),
  sendBtn:       $('sendBtn'),
  emojiBtn:      $('emojiBtn'),
  emojiPanel:    $('emojiPanel'),
  emojiGrid:     $('emojiGrid'),
  reactionPicker:$('reactionPicker'),
  reactionGrid:  $('reactionGrid'),
  typingIndicator:$('typingIndicator'),
  composerHint:  $('composerHint'),
  // 个人资料编辑
  meEditBtn:     $('meEditBtn'),
  profileModal:  $('profileModal'),
  profileNickname:$('profileNickname'),
  profileColors: $('profileColors'),
  profilePreview:$('profilePreview'),
  profileCancel: $('profileCancel'),
  profileSave:   $('profileSave'),
  // 局域网
  lanContainer:  $('lanContainer'),
  // 密码房
  modePrivateBtn:  $('modePrivateBtn'),
  privateModal:    $('privateModal'),
  privateJoinPanel: $('privateJoinPanel'),
  privateCreatePanel: $('privateCreatePanel'),
  privateJoinPassword: $('privateJoinPassword'),
  privateCreateName:   $('privateCreateName'),
  privateCreatePassword: $('privateCreatePassword'),
  privateCreateDesc:   $('privateCreateDesc'),
  privateJoinBtn:    $('privateJoinBtn'),
  privateCreateBtn:  $('privateCreateBtn'),
  privateBackBtn:    $('privateBackBtn'),
  // 搜索
  chSearchBtn:     $('chSearchBtn'),
  searchModal:     $('searchModal'),
  searchInput:     $('searchInput'),
  searchResults:   $('searchResults'),
  searchCloseBtn:  $('searchCloseBtn'),
};

// 当前模式
let currentMode = null;
// 已解锁的密码房（本地存储）
let unlockedPrivateRooms = new Set();
// 未读消息计数 { channelId: count }
let unreadCounts = {};

/* ============================================================
 *  初始化
 * ============================================================ */
function init() {
  // 检查是否有保存的模式偏好
  const savedMode = localStorage.getItem('chat_mode');
  if (savedMode === 'lan') {
    showLanLogin();
    return;
  } else if (savedMode === 'cloud') {
    initCloud();
    return;
  }

  // 默认显示模式选择
  bindModeEvents();
}

function bindModeEvents() {
  dom.modeLanBtn.addEventListener('click', () => {
    currentMode = 'lan';
    localStorage.setItem('chat_mode', 'lan');
    showLanLogin();
  });
  dom.modeCloudBtn.addEventListener('click', () => {
    currentMode = 'cloud';
    localStorage.setItem('chat_mode', 'cloud');
    initCloud();
  });
  dom.modePrivateBtn.addEventListener('click', () => {
    showPrivateModal();
  });
}

function showModeSelector() {
  localStorage.removeItem('chat_mode');
  dom.modeSelector.classList.remove('hidden');
  dom.loginModal.classList.add('hidden');
  dom.app.classList.add('hidden');
  dom.lanContainer.classList.add('hidden');
  dom.privateModal.classList.add('hidden');
  currentMode = null;
  bindModeEvents();
}

function showLanLogin() {
  dom.modeSelector.classList.add('hidden');
  dom.loginModal.classList.remove('hidden');
  dom.loginModal.querySelector('h2').textContent = '加入台球室聊天';
  dom.loginModal.querySelector('.modal-sub').textContent = '同一 WiFi 内实时聊天，无需联网';
  dom.loginModal.querySelector('.modal-hint').textContent = '提示：局域网模式仅在同一 WiFi 内有效，消息不会上传到云端。';

  renderColorPicker();
  bindEvents();

  // 检查是否已登录
  const saved = localStorage.getItem('chat_user');
  if (saved) {
    state.user = JSON.parse(saved);
    enterLanChat();
  }
}

function initCloud() {
  dom.modeSelector.classList.add('hidden');
  // 初始化 Supabase 客户端
  state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    realtime: { params: { eventsPerSecond: 10 } }
  });

  renderColorPicker();
  renderEmojiGrid();

  // 检查是否已登录
  const saved = localStorage.getItem('chat_user');
  if (saved) {
    state.user = JSON.parse(saved);
    enterApp();
  } else {
    dom.loginModal.classList.remove('hidden');
  }

  bindEvents();
}

function enterLanChat() {
  dom.loginModal.classList.add('hidden');
  dom.lanContainer.classList.remove('hidden');

  // 同步用户信息到局域网状态
  lanState.user.id = state.user.id || 'u_' + Math.random().toString(36).slice(2, 10);
  lanState.user.name = state.user.name;
  lanState.user.color = state.user.color;

  initLanChat(dom.lanContainer);
}

/* ============================================================
 *  登录流程
 * ============================================================ */
function renderColorPicker() {
  dom.colorSwatches.innerHTML = '';
  AVATAR_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'cp-swatch' + (i === 0 ? ' selected' : '');
    sw.style.background = c;
    sw.dataset.color = c;
    sw.addEventListener('click', () => {
      document.querySelectorAll('.cp-swatch').forEach(e => e.classList.remove('selected'));
      sw.classList.add('selected');
      state.user.color = c;
    });
    dom.colorSwatches.appendChild(sw);
  });
  state.user.color = AVATAR_COLORS[0];
}

function bindEvents() {
  dom.joinBtn.addEventListener('click', handleJoin);
  dom.nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJoin();
  });

  dom.sendBtn.addEventListener('click', sendMessage);
  dom.messageInput.addEventListener('keydown', handleMessageKeydown);
  dom.messageInput.addEventListener('input', handleTyping);

  dom.emojiBtn.addEventListener('click', toggleEmojiPanel);
  document.addEventListener('click', (e) => {
    if (!dom.emojiPanel.contains(e.target) && e.target !== dom.emojiBtn) {
      dom.emojiPanel.classList.add('hidden');
    }
    if (!dom.reactionPicker.contains(e.target) && !e.target.classList.contains('msg-action-btn')) {
      dom.reactionPicker.classList.add('hidden');
    }
  });

  // 移动端侧边栏开关
  dom.mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.sidebar.classList.toggle('open');
    dom.sidebarOverlay.classList.toggle('show');
  });
  dom.sidebarOverlay.addEventListener('click', () => {
    dom.sidebar.classList.remove('open');
    dom.sidebarOverlay.classList.remove('show');
  });

  // 自动调整输入框高度
  dom.messageInput.addEventListener('input', () => {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 120) + 'px';
  });

  // 移动端：键盘弹出时滚动到底部
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      scrollToBottom();
    });
  }

  // 输入框聚焦时确保可见（移动端键盘弹出）
  dom.messageInput.addEventListener('focus', () => {
    setTimeout(scrollToBottom, 300);
  });

  // 个人资料编辑
  dom.meEditBtn.addEventListener('click', openProfileEditor);
  dom.profileCancel.addEventListener('click', closeProfileEditor);
  dom.profileSave.addEventListener('click', saveProfile);
  dom.profileNickname.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveProfile();
  });
  dom.profileModal.addEventListener('click', (e) => {
    if (e.target === dom.profileModal) closeProfileEditor();
  });

  // 搜索
  dom.chSearchBtn.addEventListener('click', openSearch);
  dom.searchCloseBtn.addEventListener('click', closeSearch);
  dom.searchInput.addEventListener('input', debounce(doSearch, 300));
  dom.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  dom.searchModal.addEventListener('click', (e) => {
    if (e.target === dom.searchModal) closeSearch();
  });
}

function handleJoin() {
  const name = dom.nicknameInput.value.trim();
  if (!name) { dom.nicknameInput.focus(); return; }
  state.user.name = name;
  if (!state.user.id) {
    state.user.id = 'u_' + Math.random().toString(36).slice(2, 10);
  }
  localStorage.setItem('chat_user', JSON.stringify(state.user));

  if (currentMode === 'lan' || localStorage.getItem('chat_mode') === 'lan') {
    enterLanChat();
  } else {
    enterApp();
    // 如果有待进入的密码房，自动选中
    if (state.pendingPrivateChannel) {
      setTimeout(() => {
        selectChannel(state.pendingPrivateChannel);
        state.pendingPrivateChannel = null;
      }, 600);
    }
  }
}

/* ============================================================
 *  个人资料编辑
 * ============================================================ */
let profileSelectedColor = null;

function openProfileEditor() {
  dom.profileNickname.value = state.user.name;
  profileSelectedColor = state.user.color;

  // 渲染颜色选择器
  dom.profileColors.innerHTML = '';
  AVATAR_COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === profileSelectedColor ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      profileSelectedColor = c;
      dom.profileColors.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      updateProfilePreview();
    });
    dom.profileColors.appendChild(sw);
  });

  updateProfilePreview();
  dom.profileModal.classList.remove('hidden');
  setTimeout(() => dom.profileNickname.focus(), 100);
}

function updateProfilePreview() {
  const name = dom.profileNickname.value.trim() || '?';
  dom.profilePreview.textContent = name[0].toUpperCase();
  dom.profilePreview.style.background = profileSelectedColor;
}

// 实时更新预览
document.addEventListener('DOMContentLoaded', () => {
  // 延迟绑定，确保 DOM 元素已存在
  setTimeout(() => {
    if (dom.profileNickname) {
      dom.profileNickname.addEventListener('input', updateProfilePreview);
    }
  }, 500);
});

function closeProfileEditor() {
  dom.profileModal.classList.add('hidden');
}

async function saveProfile() {
  const newName = dom.profileNickname.value.trim();
  if (!newName) {
    dom.profileNickname.focus();
    return;
  }

  const oldName = state.user.name;
  const oldColor = state.user.color;
  state.user.name = newName;
  state.user.color = profileSelectedColor;
  localStorage.setItem('chat_user', JSON.stringify(state.user));

  // 更新侧边栏显示
  dom.meAvatar.textContent = newName[0].toUpperCase();
  dom.meAvatar.style.background = profileSelectedColor;
  dom.meName.textContent = newName;

  // 更新 Presence，让其他用户看到新名字
  if (state.presenceChannel) {
    await state.presenceChannel.track({
      user_id: state.user.id,
      name: state.user.name,
      color: state.user.color,
      online_at: new Date().toISOString(),
    });
  }

  // 广播改名通知
  if (state.presenceChannel && oldName !== newName) {
    state.presenceChannel.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        user_id: state.user.id,
        name: state.user.name,
        color: state.user.color,
        channel_id: state.currentChannel?.id,
        system: true,
        text: `${oldName} 已改名为 ${newName}`,
      },
    });
  }

  closeProfileEditor();
}

function enterApp() {
  dom.loginModal.classList.add('hidden');
  dom.app.classList.remove('hidden');

  // 渲染当前用户信息
  dom.meAvatar.textContent = state.user.name[0].toUpperCase();
  dom.meAvatar.style.background = state.user.color;
  dom.meName.textContent = state.user.name;

  loadChannels().then(() => {
    // 默认选中第一个频道
    if (state.channels.length > 0) {
      selectChannel(state.channels[0]);
    }
    joinPresence();
  });
}

/* ============================================================
 *  频道加载
 * ============================================================ */
async function loadChannels() {
  const { data, error } = await state.supabase
    .from('channels')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('加载频道失败:', error); return; }
  state.channels = data || [];
  renderChannelList();
}

function renderChannelList() {
  dom.channelList.innerHTML = '';
  state.channels.forEach(ch => {
    const li = document.createElement('li');
    const isPrivate = ch.is_private;
    const isLocked = isPrivate && !unlockedPrivateRooms.has(ch.id);
    const unread = unreadCounts[ch.id] || 0;
    li.className = 'channel-item' + (ch.type === 'treehole' ? ' treehole' : '') + (isPrivate ? ' private' : '');
    li.dataset.id = ch.id;
    li.innerHTML = `
      <span class="ch-icon">${ch.type === 'treehole' ? '🌳' : (isPrivate ? '🔒' : '#')}</span>
      <span class="ch-label">${ch.name}</span>
      ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
      ${isPrivate && !unread ? '<span class="ch-lock">🔒</span>' : ''}
    `;
    li.addEventListener('click', () => {
      if (isLocked) {
        promptPrivatePassword(ch);
        return;
      }
      selectChannel(ch);
      clearUnread(ch.id);
      // 移动端选频道后关闭侧边栏
      dom.sidebar.classList.remove('open');
      dom.sidebarOverlay.classList.remove('show');
    });
    dom.channelList.appendChild(li);
  });
}

/* ============================================================
 *  选择频道 & 订阅 Realtime
 * ============================================================ */
async function selectChannel(channel) {
  if (state.currentChannel?.id === channel.id) return;

  // 清理旧订阅
  if (state.dbChannel)      state.supabase.removeChannel(state.dbChannel);
  if (state.reactionChannel) state.supabase.removeChannel(state.reactionChannel);

  state.currentChannel = channel;
  state.messages = [];
  state.messageEls.clear();
  state.lastAuthor = null;
  state.lastDateStr = null;
  dom.messages.innerHTML = '';

  // 更新头部
  dom.chHash.textContent  = channel.type === 'treehole' ? '🌳' : '#';
  dom.chName.textContent  = channel.name;
  dom.chDesc.textContent  = channel.description || '';
  dom.messageInput.placeholder = `在 ${channel.type === 'treehole' ? '🌳' : '#'}${channel.name} 发送消息…  (Enter 发送 / Shift+Enter 换行)`;

  // 高亮频道
  document.querySelectorAll('.channel-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === channel.id);
  });

  // 树洞提示
  if (channel.type === 'treehole') {
    dom.composerHint.textContent = '🌳 匿名树洞模式：你的消息将以匿名身份显示，其他用户看不到你是谁。';
  } else {
    dom.composerHint.textContent = '';
  }

  // 1. 加载历史消息
  await loadMessages(channel.id);

  // 2. 订阅消息表变更 (INSERT / DELETE)
  subscribeMessages(channel.id);

  // 3. 订阅表情反应变更
  subscribeReactions(channel.id);
}

/* ============================================================
 *  加载历史消息
 * ============================================================ */
async function loadMessages(channelId) {
  const { data, error } = await state.supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) { console.error('加载消息失败:', error); return; }

  // 批量加载这些消息的反应
  if (data && data.length > 0) {
    const ids = data.map(m => m.id);
    const { data: reacts } = await state.supabase
      .from('reactions')
      .select('*')
      .in('message_id', ids);
    // 按 message_id 分组
    const reactMap = {};
    (reacts || []).forEach(r => {
      if (!reactMap[r.message_id]) reactMap[r.message_id] = {};
      if (!reactMap[r.message_id][r.emoji]) reactMap[r.message_id][r.emoji] = [];
      reactMap[r.message_id][r.emoji].push(r.user_id);
    });
    data.forEach(m => { m.reactions = reactMap[m.id] || {}; });
  }

  state.messages = data || [];
  state.lastAuthor = null;
  state.lastDateStr = null;
  state.messages.forEach(m => renderMessage(m, false));
  scrollToBottom();
}

/* ============================================================
 *  订阅消息表 Realtime (Postgres Changes)
 * ============================================================ */
function subscribeMessages(channelId) {
  const chName = `msgs:${channelId}`;
  state.dbChannel = state.supabase
    .channel(chName)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        const m = payload.new;
        m.reactions = {};
        // 去重：避免重复渲染
        if (state.messages.find(x => x.id === m.id)) return;
        state.messages.push(m);
        renderMessage(m, true);
        scrollToBottom();
        // 如果不是自己发的消息，增加未读计数并播放提示音
        if (m.user_id !== state.user.id) {
          incrementUnread(channelId);
          playNotificationSound();
        }
      }
    )
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        const m = payload.new;
        const idx = state.messages.findIndex(x => x.id === m.id);
        if (idx >= 0) {
          state.messages[idx] = { ...state.messages[idx], ...m };
          // 重新渲染该消息
          const el = state.messageEls.get(m.id);
          if (el) {
            // 获取该消息之前的所有元素（日期分隔符等）保持不变
            const next = el.nextSibling;
            el.remove();
            state.messageEls.delete(m.id);
            // 临时重置 lastAuthor 以便正确渲染
            const prevEl = next ? next.previousElementSibling : dom.messages.lastElementChild;
            state.lastAuthor = prevEl?.classList.contains('msg-group') ? null : state.lastAuthor;
            renderMessage(state.messages[idx], false);
          }
        }
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        const id = payload.old.id;
        const el = state.messageEls.get(id);
        if (el) { el.remove(); state.messageEls.delete(id); }
        state.messages = state.messages.filter(m => m.id !== id);
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ 消息频道已连接');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('⚠️ 消息频道断开，3秒后自动重连...', err);
        setTimeout(() => {
          if (state.currentChannel?.id === channelId) {
            console.log('重新订阅消息频道...');
            subscribeMessages(channelId);
          }
        }, 3000);
      }
    });
}

/* ============================================================
 *  订阅表情反应 Realtime
 * ============================================================ */
function subscribeReactions(channelId) {
  state.reactionChannel = state.supabase
    .channel(`reacts:${channelId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'reactions' },
      (payload) => {
        addReactionLocally(payload.new);
      }
    )
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'reactions' },
      (payload) => {
        removeReactionLocally(payload.old);
      }
    )
    .subscribe();
}

function addReactionLocally(r) {
  const msg = state.messages.find(m => m.id === r.message_id);
  if (!msg) return;
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[r.emoji]) msg.reactions[r.emoji] = [];
  if (!msg.reactions[r.emoji].includes(r.user_id)) {
    msg.reactions[r.emoji].push(r.user_id);
  }
  renderReactions(msg);
}

function removeReactionLocally(r) {
  const msg = state.messages.find(m => m.id === r.message_id);
  if (!msg || !msg.reactions || !msg.reactions[r.emoji]) return;
  msg.reactions[r.emoji] = msg.reactions[r.emoji].filter(uid => uid !== r.user_id);
  if (msg.reactions[r.emoji].length === 0) delete msg.reactions[r.emoji];
  renderReactions(msg);
}

/* ============================================================
 *  渲染单条消息
 * ============================================================ */
function renderMessage(msg, animate) {
  const isAnon = msg.is_anon || state.currentChannel?.type === 'treehole';
  const displayName = isAnon ? '匿名' : msg.username;
  const displayColor = isAnon ? '#666' : msg.avatar_color;
  const isDeleted = msg.is_deleted;

  // 日期分隔
  const dateStr = formatDateSeparator(msg.created_at);
  if (dateStr !== state.lastDateStr) {
    state.lastDateStr = dateStr;
    const sep = document.createElement('div');
    sep.className = 'msg-system';
    sep.innerHTML = `<span>${dateStr}</span>`;
    dom.messages.appendChild(sep);
    state.lastAuthor = null;
  }

  // 同作者连续消息合并
  const sameAuthor = state.lastAuthor === msg.user_id && !isAnon;

  const group = document.createElement('div');
  const isMe = msg.user_id === state.user.id && !isAnon;
  group.className = 'msg-group' + (sameAuthor ? ' same-author' : '') + (isMe ? ' me' : '') + (isDeleted ? ' deleted' : '');
  group.dataset.id = msg.id;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.style.background = displayColor;
  avatar.textContent = sameAuthor ? '' : displayName[0].toUpperCase();

  const body = document.createElement('div');
  body.className = 'msg-body';

  if (!sameAuthor) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const author = document.createElement('span');
    author.className = 'msg-author' + (isAnon ? ' anon' : '');
    author.textContent = displayName;
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatTime(msg.created_at);
    meta.appendChild(author);
    meta.appendChild(time);
    body.appendChild(meta);
  }

  // 引用消息
  if (msg.reply_to && !isDeleted) {
    const quotedMsg = state.messages.find(m => m.id === msg.reply_to);
    if (quotedMsg) {
      const quoteDiv = document.createElement('div');
      quoteDiv.className = 'msg-quote';
      const qName = quotedMsg.is_anon ? '匿名' : quotedMsg.username;
      quoteDiv.innerHTML = `
        <div class="mq-name">${escapeHtml(qName)}</div>
        <div class="mq-text">${escapeHtml(quotedMsg.content)}</div>
      `;
      body.appendChild(quoteDiv);
    }
  }

  const content = document.createElement('div');
  content.className = 'msg-content';
  if (isDeleted) {
    content.innerHTML = '<em style="color:#999;font-size:13px;">消息已撤回</em>';
  } else {
    content.innerHTML = highlightMentions(escapeHtml(msg.content));
  }
  body.appendChild(content);

  // 反应区（已撤回消息不显示）
  if (!isDeleted) {
    const reactDiv = document.createElement('div');
    reactDiv.className = 'msg-reactions';
    reactDiv.dataset.msgId = msg.id;
    body.appendChild(reactDiv);
  }

  // 操作按钮
  if (!isDeleted) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    // 引用
    const quoteBtn = document.createElement('button');
    quoteBtn.className = 'msg-action-btn';
    quoteBtn.textContent = '↩️';
    quoteBtn.title = '引用回复';
    quoteBtn.addEventListener('click', () => startQuoteReply(msg));
    actions.appendChild(quoteBtn);

    // 添加反应
    const reactBtn = document.createElement('button');
    reactBtn.className = 'msg-action-btn';
    reactBtn.textContent = '😊';
    reactBtn.title = '添加反应';
    reactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showReactionPicker(e.target, msg.id);
    });
    actions.appendChild(reactBtn);

    // 自己的消息可撤回（2分钟内）
    if (msg.user_id === state.user.id) {
      const age = Date.now() - new Date(msg.created_at).getTime();
      if (age < 2 * 60 * 1000) {
        const revokeBtn = document.createElement('button');
        revokeBtn.className = 'msg-action-btn';
        revokeBtn.textContent = '↩';
        revokeBtn.title = '撤回';
        revokeBtn.addEventListener('click', () => revokeMessage(msg.id));
        actions.appendChild(revokeBtn);
      }
    }

    group.appendChild(actions);
  }

  group.appendChild(avatar);
  group.appendChild(body);

  if (animate) {
    group.style.opacity = '0';
    group.style.transform = 'translateY(8px)';
    requestAnimationFrame(() => {
      group.style.transition = 'opacity .25s, transform .25s';
      group.style.opacity = '1';
      group.style.transform = 'translateY(0)';
    });
  }

  dom.messages.appendChild(group);
  state.messageEls.set(msg.id, group);
  state.lastAuthor = msg.user_id;

  if (!isDeleted) renderReactions(msg);
}

/* ============================================================
 *  渲染消息的反应
 * ============================================================ */
function renderReactions(msg) {
  const group = state.messageEls.get(msg.id);
  if (!group) return;
  const reactDiv = group.querySelector('.msg-reactions');
  reactDiv.innerHTML = '';

  if (!msg.reactions) return;
  Object.entries(msg.reactions).forEach(([emoji, users]) => {
    if (!users || users.length === 0) return;
    const chip = document.createElement('span');
    chip.className = 'reaction-chip' + (users.includes(state.user.id) ? ' mine' : '');
    chip.innerHTML = `<span class="rc-emoji">${emoji}</span><span class="rc-count">${users.length}</span>`;
    chip.addEventListener('click', () => toggleReaction(msg.id, emoji, users.includes(state.user.id)));
    reactDiv.appendChild(chip);
  });
}

/* ============================================================
 *  @提及高亮
 * ============================================================ */
function highlightMentions(html) {
  // 匹配 @用户名（支持中文、英文、数字、下划线）
  return html.replace(/@([\u4e00-\u9fa5a-zA-Z0-9_]+)/g, '<span class="mention">@$1</span>');
}

/* ============================================================
 *  引用回复
 * ============================================================ */
let quotingMessage = null;

function startQuoteReply(msg) {
  quotingMessage = msg;
  showQuotePreview(msg);
  dom.messageInput.focus();
}

function showQuotePreview(msg) {
  let preview = document.getElementById('quotePreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'quotePreview';
    preview.className = 'quote-preview';
    dom.composer.insertBefore(preview, dom.composer.firstChild);
  }
  const name = msg.is_anon ? '匿名' : msg.username;
  preview.innerHTML = `
    <div class="qp-inner">
      <span class="qp-label">引用 ${escapeHtml(name)}</span>
      <span class="qp-text">${escapeHtml(msg.content)}</span>
      <button class="qp-close" title="取消引用">✕</button>
    </div>
  `;
  preview.querySelector('.qp-close').addEventListener('click', clearQuotePreview);
  preview.classList.remove('hidden');
}

function clearQuotePreview() {
  quotingMessage = null;
  const preview = document.getElementById('quotePreview');
  if (preview) preview.classList.add('hidden');
}

/* ============================================================
 *  消息撤回
 * ============================================================ */
async function revokeMessage(messageId) {
  if (!confirm('确定撤回这条消息吗？')) return;
  const { error } = await state.supabase
    .from('messages')
    .update({ is_deleted: true, content: '消息已撤回' })
    .eq('id', messageId);
  if (error) {
    alert('撤回失败: ' + error.message);
  }
}

/* ============================================================
 *  发送消息
 * ============================================================ */
async function sendMessage() {
  const text = dom.messageInput.value.trim();
  if (!text || !state.currentChannel) return;

  const isAnon = state.currentChannel.type === 'treehole';

  const payload = {
    channel_id: state.currentChannel.id,
    user_id:    state.user.id,
    username:   state.user.name,
    avatar_color: state.user.color,
    content:    text,
    is_anon:    isAnon,
  };

  // 如果有引用回复
  if (quotingMessage) {
    payload.reply_to = quotingMessage.id;
    clearQuotePreview();
  }

  dom.sendBtn.disabled = true;
  const { error } = await state.supabase.from('messages').insert(payload);

  dom.sendBtn.disabled = false;
  if (error) {
    console.error('发送失败:', error);
    dom.composerHint.textContent = '⚠️ 发送失败: ' + error.message;
    return;
  }

  dom.messageInput.value = '';
  dom.messageInput.style.height = 'auto';
  stopTyping();
}

function handleMessageKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

/* ============================================================
 *  删除消息
 * ============================================================ */
async function deleteMessage(id) {
  const { error } = await state.supabase.from('messages').delete().eq('id', id);
  if (error) console.error('删除失败:', error);
}

/* ============================================================
 *  表情反应
 * ============================================================ */
async function toggleReaction(messageId, emoji, hasReacted) {
  if (hasReacted) {
    await state.supabase.from('reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('emoji', emoji)
      .eq('user_id', state.user.id);
  } else {
    await state.supabase.from('reactions').insert({
      message_id: messageId,
      emoji,
      user_id: state.user.id,
    });
  }
}

function showReactionPicker(anchor, messageId) {
  dom.reactionGrid.innerHTML = '';
  QUICK_REACTIONS.forEach(emoji => {
    const item = document.createElement('div');
    item.className = 'rp-item';
    item.textContent = emoji;
    item.addEventListener('click', () => {
      const msg = state.messages.find(m => m.id === messageId);
      const has = msg?.reactions?.[emoji]?.includes(state.user.id);
      toggleReaction(messageId, emoji, has);
      dom.reactionPicker.classList.add('hidden');
    });
    dom.reactionGrid.appendChild(item);
  });

  const rect = anchor.getBoundingClientRect();
  dom.reactionPicker.style.top  = (rect.top - 45) + 'px';
  dom.reactionPicker.style.left = rect.left + 'px';
  dom.reactionPicker.classList.remove('hidden');
}

/* ============================================================
 *  表情面板（输入框用）
 * ============================================================ */
function renderEmojiGrid() {
  dom.emojiGrid.innerHTML = '';
  EMOJIS.forEach(emoji => {
    const item = document.createElement('div');
    item.className = 'ep-item';
    item.textContent = emoji;
    item.addEventListener('click', () => {
      const start = dom.messageInput.selectionStart;
      const end   = dom.messageInput.selectionEnd;
      const val   = dom.messageInput.value;
      dom.messageInput.value = val.slice(0, start) + emoji + val.slice(end);
      dom.messageInput.selectionStart = dom.messageInput.selectionEnd = start + emoji.length;
      dom.messageInput.focus();
    });
    dom.emojiGrid.appendChild(item);
  });
}

function toggleEmojiPanel(e) {
  e.stopPropagation();
  dom.emojiPanel.classList.toggle('hidden');
}

/* ============================================================
 *  Presence — 在线状态 & 打字指示
 * ============================================================ */
function joinPresence() {
  state.presenceChannel = state.supabase.channel('online-users', {
    config: { presence: { key: state.user.id } },
  });

  state.presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const presence = state.presenceChannel.presenceState();
      renderMembers(presence);
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      // 可选：显示加入提示
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      // 可选：显示离开提示
    })
    // 监听打字广播
    .on('broadcast', { event: 'typing' }, (payload) => {
      handleIncomingTyping(payload);
    })
    .subscribe(async (status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Presence 已连接');
        await state.presenceChannel.track({
          user_id: state.user.id,
          name: state.user.name,
          color: state.user.color,
          online_at: new Date().toISOString(),
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('⚠️ Presence 断开，5秒后自动重连...', err);
        setTimeout(() => {
          if (state.presenceChannel) {
            console.log('重新连接 Presence...');
            state.presenceChannel.subscribe();
          }
        }, 5000);
      }
    });
}

function renderMembers(presence) {
  const users = [];
  Object.entries(presence).forEach(([key, arr]) => {
    if (arr[0]) users.push(arr[0]);
  });

  dom.onlineCount.textContent = `${users.length} 在线`;
  dom.chMembers.textContent = `${users.length} 成员`;

  dom.memberList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.className = 'member-item';
    li.innerHTML = `
      <div class="member-avatar" style="background:${u.color}">${u.name[0].toUpperCase()}</div>
      <span class="member-dot"></span>
      <span class="member-name">${escapeHtml(u.name)}${u.user_id === state.user.id ? ' (你)' : ''}</span>
    `;
    dom.memberList.appendChild(li);
  });
}

/* ---- 打字指示 ---- */
function handleTyping() {
  if (!state.presenceChannel || !state.currentChannel) return;
  if (!state.isTyping) {
    state.isTyping = true;
    broadcastTyping(true);
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.isTyping = false;
    broadcastTyping(false);
  }, 2000);
}

function broadcastTyping(isTyping) {
  state.presenceChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: {
      user_id: state.user.id,
      name: state.user.name,
      channel_id: state.currentChannel?.id,
      typing: isTyping,
    },
  });
}

function stopTyping() {
  state.isTyping = false;
  clearTimeout(state.typingTimer);
  broadcastTyping(false);
}

const typingUsers = new Map(); // userId -> {name, timer}
function handleIncomingTyping(payload) {
  const { user_id, name, channel_id, typing } = payload.payload;
  if (user_id === state.user.id) return;
  if (channel_id !== state.currentChannel?.id) return;

  if (typing) {
    typingUsers.set(user_id, { name });
    clearTimeout(typingUsers.get(user_id)?.timer);
    const t = setTimeout(() => {
      typingUsers.delete(user_id);
      updateTypingIndicator();
    }, 3000);
    typingUsers.get(user_id).timer = t;
  } else {
    typingUsers.delete(user_id);
  }
  updateTypingIndicator();
}

function updateTypingIndicator() {
  if (typingUsers.size === 0) {
    dom.typingIndicator.textContent = '';
  } else {
    const names = Array.from(typingUsers.values()).map(t => t.name);
    if (names.length === 1) {
      dom.typingIndicator.textContent = `${names[0]} 正在输入…`;
    } else if (names.length <= 3) {
      dom.typingIndicator.textContent = `${names.join('、')} 正在输入…`;
    } else {
      dom.typingIndicator.textContent = `${names.length} 人正在输入…`;
    }
  }
}

/* ============================================================
 *  搜索功能
 * ============================================================ */
function openSearch() {
  dom.searchModal.classList.remove('hidden');
  dom.searchInput.value = '';
  dom.searchResults.innerHTML = '';
  setTimeout(() => dom.searchInput.focus(), 100);
}

function closeSearch() {
  dom.searchModal.classList.add('hidden');
}

function doSearch() {
  const query = dom.searchInput.value.trim().toLowerCase();
  dom.searchResults.innerHTML = '';
  if (!query || !state.messages.length) {
    dom.searchResults.innerHTML = '<div class="search-empty">输入关键词搜索消息</div>';
    return;
  }

  const results = state.messages.filter(m =>
    !m.is_deleted && m.content.toLowerCase().includes(query)
  );

  if (results.length === 0) {
    dom.searchResults.innerHTML = '<div class="search-empty">未找到匹配的消息</div>';
    return;
  }

  results.forEach(msg => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    const name = msg.is_anon ? '匿名' : msg.username;
    const time = formatTime(msg.created_at);
    // 高亮匹配文本
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    const highlighted = escapeHtml(msg.content).replace(regex, '<span class="sr-highlight">$1</span>');
    item.innerHTML = `
      <div class="sr-meta">${escapeHtml(name)} · ${time}</div>
      <div class="sr-text">${highlighted}</div>
    `;
    item.addEventListener('click', () => {
      closeSearch();
      const el = state.messageEls.get(msg.id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.background = 'rgba(18,183,245,.15)';
        setTimeout(() => { el.style.background = ''; }, 2000);
      }
    });
    dom.searchResults.appendChild(item);
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ============================================================
 *  未读消息计数
 * ============================================================ */
function incrementUnread(channelId) {
  if (!channelId || channelId === state.currentChannel?.id) return;
  unreadCounts[channelId] = (unreadCounts[channelId] || 0) + 1;
  renderChannelList();
}

function clearUnread(channelId) {
  delete unreadCounts[channelId];
  renderChannelList();
}

/* ============================================================
 *  提示音
 * ============================================================ */
let audioCtx = null;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880; // A5
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) { /* 忽略音频错误 */ }
}

/* ============================================================
 *  工具函数
 * ============================================================ */
function scrollToBottom() {
  requestAnimationFrame(() => {
    dom.messages.scrollTop = dom.messages.scrollHeight;
  });
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return '今天';
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
 *  密码房功能
 * ============================================================ */
function showPrivateModal() {
  dom.modeSelector.classList.add('hidden');
  dom.privateModal.classList.remove('hidden');
  dom.privateJoinPassword.value = '';
  dom.privateCreateName.value = '';
  dom.privateCreatePassword.value = '';
  dom.privateCreateDesc.value = '';
  switchPrivateTab('join');
  bindPrivateEvents();
}

function bindPrivateEvents() {
  // 标签切换
  dom.privateModal.querySelectorAll('.private-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchPrivateTab(tab.dataset.tab);
    });
  });

  // 加入房间
  dom.privateJoinBtn.addEventListener('click', joinPrivateRoom);
  dom.privateJoinPassword.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinPrivateRoom();
  });

  // 创建房间
  dom.privateCreateBtn.addEventListener('click', createPrivateRoom);
  dom.privateCreateName.addEventListener('keydown', e => {
    if (e.key === 'Enter') dom.privateCreatePassword.focus();
  });
  dom.privateCreatePassword.addEventListener('keydown', e => {
    if (e.key === 'Enter') createPrivateRoom();
  });

  // 返回
  dom.privateBackBtn.addEventListener('click', () => {
    dom.privateModal.classList.add('hidden');
    showModeSelector();
  });

  // 点击遮罩关闭
  dom.privateModal.addEventListener('click', (e) => {
    if (e.target === dom.privateModal) {
      dom.privateModal.classList.add('hidden');
      showModeSelector();
    }
  });
}

function switchPrivateTab(tab) {
  dom.privateModal.querySelectorAll('.private-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  if (tab === 'join') {
    dom.privateJoinPanel.classList.remove('hidden');
    dom.privateCreatePanel.classList.add('hidden');
    setTimeout(() => dom.privateJoinPassword.focus(), 100);
  } else {
    dom.privateJoinPanel.classList.add('hidden');
    dom.privateCreatePanel.classList.remove('hidden');
    setTimeout(() => dom.privateCreateName.focus(), 100);
  }
}

async function joinPrivateRoom() {
  const password = dom.privateJoinPassword.value.trim();
  if (!password) { dom.privateJoinPassword.focus(); return; }

  // 先初始化 Supabase
  if (!state.supabase) {
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }

  // 查找匹配密码的房间
  const { data, error } = await state.supabase
    .from('channels')
    .select('*')
    .eq('is_private', true)
    .eq('password', password)
    .single();

  if (error || !data) {
    alert('密码错误，未找到对应的房间');
    dom.privateJoinPassword.focus();
    return;
  }

  // 解锁该房间
  unlockedPrivateRooms.add(data.id);
  localStorage.setItem('unlocked_private_rooms', JSON.stringify([...unlockedPrivateRooms]));

  dom.privateModal.classList.add('hidden');
  currentMode = 'cloud';
  localStorage.setItem('chat_mode', 'cloud');

  // 进入云端聊天
  renderEmojiGrid();
  const saved = localStorage.getItem('chat_user');
  if (saved) {
    state.user = JSON.parse(saved);
    enterApp();
    // 加载频道后自动选中该房间
    setTimeout(() => selectChannel(data), 500);
  } else {
    dom.loginModal.classList.remove('hidden');
    // 登录后自动进入该房间
    state.pendingPrivateChannel = data;
  }
}

async function createPrivateRoom() {
  const name = dom.privateCreateName.value.trim();
  const password = dom.privateCreatePassword.value.trim();
  const desc = dom.privateCreateDesc.value.trim();

  if (!name) { dom.privateCreateName.focus(); return; }
  if (!password) { dom.privateCreatePassword.focus(); return; }

  // 先初始化 Supabase
  if (!state.supabase) {
    state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }

  const { data, error } = await state.supabase.from('channels').insert({
    name: name,
    type: 'private',
    description: desc || '私密聊天室',
    is_private: true,
    password: password,
  }).select().single();

  if (error) {
    alert('创建房间失败: ' + error.message);
    return;
  }

  // 自动解锁
  unlockedPrivateRooms.add(data.id);
  localStorage.setItem('unlocked_private_rooms', JSON.stringify([...unlockedPrivateRooms]));

  dom.privateModal.classList.add('hidden');
  currentMode = 'cloud';
  localStorage.setItem('chat_mode', 'cloud');

  // 进入云端聊天
  renderEmojiGrid();
  const saved = localStorage.getItem('chat_user');
  if (saved) {
    state.user = JSON.parse(saved);
    enterApp();
    setTimeout(() => selectChannel(data), 500);
  } else {
    dom.loginModal.classList.remove('hidden');
    state.pendingPrivateChannel = data;
  }
}

function promptPrivatePassword(channel) {
  const input = prompt(`「${channel.name}」需要密码才能进入：`, '');
  if (input === null) return; // 用户取消
  const password = input.trim();
  if (!password) return;

  if (password === channel.password) {
    unlockedPrivateRooms.add(channel.id);
    localStorage.setItem('unlocked_private_rooms', JSON.stringify([...unlockedPrivateRooms]));
    selectChannel(channel);
    renderChannelList(); // 重新渲染以更新锁图标
  } else {
    alert('密码错误');
  }
}

// 加载已解锁的密码房
function loadUnlockedRooms() {
  try {
    const saved = localStorage.getItem('unlocked_private_rooms');
    if (saved) {
      unlockedPrivateRooms = new Set(JSON.parse(saved));
    }
  } catch (e) { /* ignore */ }
}

/* ============================================================
 *  启动
 * ============================================================ */
window.addEventListener('DOMContentLoaded', () => {
  loadUnlockedRooms();
  init();
});
