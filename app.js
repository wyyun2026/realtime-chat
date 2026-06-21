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
};

/* ============================================================
 *  初始化
 * ============================================================ */
function init() {
  // 初始化 Supabase 客户端
  state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    realtime: { params: { eventsPerSecond: 10 } }
  });

  renderColorPicker();
  renderEmojiGrid();

  // 检查是否已登录（localStorage）
  const saved = localStorage.getItem('chat_user');
  if (saved) {
    state.user = JSON.parse(saved);
    enterApp();
  } else {
    dom.loginModal.classList.remove('hidden');
  }

  bindEvents();
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
}

function handleJoin() {
  const name = dom.nicknameInput.value.trim();
  if (!name) { dom.nicknameInput.focus(); return; }
  state.user.name = name;
  state.user.id   = 'u_' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('chat_user', JSON.stringify(state.user));
  enterApp();
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
    li.className = 'channel-item' + (ch.type === 'treehole' ? ' treehole' : '');
    li.dataset.id = ch.id;
    li.innerHTML = `
      <span class="ch-icon">${ch.type === 'treehole' ? '🌳' : '#'}</span>
      <span class="ch-label">${ch.name}</span>
    `;
    li.addEventListener('click', () => {
      selectChannel(ch);
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
    .limit(200);
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

  // 日期分隔
  const dateStr = formatDateSeparator(msg.created_at);
  if (dateStr !== state.lastDateStr) {
    state.lastDateStr = dateStr;
    const sep = document.createElement('div');
    sep.className = 'msg-system';
    sep.innerHTML = `<span>${dateStr}</span>`;
    dom.messages.appendChild(sep);
    state.lastAuthor = null; // 日期分隔后重置作者
  }

  // 同作者连续消息合并
  const sameAuthor = state.lastAuthor === msg.user_id && !isAnon;

  const group = document.createElement('div');
  group.className = 'msg-group' + (sameAuthor ? ' same-author' : '');
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

  const content = document.createElement('div');
  content.className = 'msg-content';
  content.innerHTML = escapeHtml(msg.content);
  body.appendChild(content);

  // 反应区
  const reactDiv = document.createElement('div');
  reactDiv.className = 'msg-reactions';
  reactDiv.dataset.msgId = msg.id;
  body.appendChild(reactDiv);

  // 操作按钮（添加反应 / 删除）
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const reactBtn = document.createElement('button');
  reactBtn.className = 'msg-action-btn';
  reactBtn.textContent = '😊';
  reactBtn.title = '添加反应';
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showReactionPicker(e.target, msg.id);
  });
  actions.appendChild(reactBtn);

  // 自己的消息可以删除
  if (msg.user_id === state.user.id) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn';
    delBtn.textContent = '🗑';
    delBtn.title = '删除';
    delBtn.addEventListener('click', () => deleteMessage(msg.id));
    actions.appendChild(delBtn);
  }

  group.appendChild(avatar);
  group.appendChild(body);
  group.appendChild(actions);

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

  renderReactions(msg);
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
 *  发送消息
 * ============================================================ */
async function sendMessage() {
  const text = dom.messageInput.value.trim();
  if (!text || !state.currentChannel) return;

  const isAnon = state.currentChannel.type === 'treehole';

  dom.sendBtn.disabled = true;
  const { error } = await state.supabase.from('messages').insert({
    channel_id: state.currentChannel.id,
    user_id:    state.user.id,
    username:   state.user.name,
    avatar_color: state.user.color,
    content:    text,
    is_anon:    isAnon,
  });

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
 *  启动
 * ============================================================ */
window.addEventListener('DOMContentLoaded', init);
