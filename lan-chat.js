/* ============================================================
 *  台球室局域网聊天室 — 纯 P2P 模式（无需服务器）
 *  使用 WebRTC DataChannel 建立网状网络，同一 WiFi 内自动发现
 * ============================================================ */

const LAN_COLORS = [
  '#611f69','#e01e5a','#2eb67d','#f2c744','#36c5f0',
  '#ecb22e','#e5322d','#7b68ee','#ff7f50','#40e0d0',
  '#da70d6','#ff6347','#4682b4','#32cd99','#ff69b4'
];

const LAN_EMOJIS = [
  '😀','😂','🥰','😎','🤔','😴','😭','😡',
  '👍','👎','👏','🙏','💪','🎉','🔥','💯',
  '❤️','💔','✨','⚡','🚀','☕','🍕','🍺',
  '👀','💀','🤡','👻','🤖','🌈','⭐','💎'
];

/* ============ 局域网状态 ============ */
const lanState = {
  mode: 'lan',           // 'lan' | 'supabase'
  user: { id: '', name: '', color: '#611f69' },
  roomId: 'billiard-room',
  peers: new Map(),      // peerId -> { pc, dc, name, color, lastSeen }
  messages: [],          // { id, userId, name, color, content, time }
  messageEls: new Map(),
  isTyping: false,
  typingTimer: null,
  broadcastChannel: null,
};

// 简单的信令：用 BroadcastChannel 做局域网内发现
// 同一 WiFi + 同浏览器环境（同 origin 或同 localStorage）
function initLanSignaling() {
  const bc = new BroadcastChannel('billiard_lan_chat');
  lanState.broadcastChannel = bc;

  bc.onmessage = (event) => {
    const msg = event.data;
    if (!msg || msg.from === lanState.user.id) return;

    switch (msg.type) {
      case 'hello':
        // 收到新 peer 的问候，尝试连接
        if (!lanState.peers.has(msg.from)) {
          connectToPeer(msg.from, msg.data);
        }
        // 回复自己的信息
        bc.postMessage({
          type: 'hello-back',
          from: lanState.user.id,
          to: msg.from,
          data: { name: lanState.user.name, color: lanState.user.color }
        });
        break;
      case 'hello-back':
        if (msg.to === lanState.user.id && !lanState.peers.has(msg.from)) {
          connectToPeer(msg.from, msg.data);
        }
        break;
      case 'webrtc-offer':
        handleOffer(msg.from, msg.data);
        break;
      case 'webrtc-answer':
        handleAnswer(msg.from, msg.data);
        break;
      case 'webrtc-ice':
        handleIceCandidate(msg.from, msg.data);
        break;
    }
  };

  // 定期广播自己的存在
  setInterval(() => {
    bc.postMessage({
      type: 'hello',
      from: lanState.user.id,
      data: { name: lanState.user.name, color: lanState.user.color }
    });
  }, 3000);

  // 立即广播一次
  bc.postMessage({
    type: 'hello',
    from: lanState.user.id,
    data: { name: lanState.user.name, color: lanState.user.color }
  });
}

/* ============ WebRTC P2P 连接 ============ */
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  const dc = pc.createDataChannel('chat', {
    ordered: true,
    maxRetransmits: 3
  });

  setupDataChannel(dc, peerId);

  pc.ondatachannel = (event) => {
    setupDataChannel(event.channel, peerId);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      lanState.broadcastChannel.postMessage({
        type: 'webrtc-ice',
        from: lanState.user.id,
        to: peerId,
        data: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      lanState.peers.delete(peerId);
      renderLanMembers();
    }
  };

  return { pc, dc };
}

async function connectToPeer(peerId, peerInfo) {
  const { pc, dc } = createPeerConnection(peerId);
  lanState.peers.set(peerId, { pc, dc, name: peerInfo?.name || '未知', color: peerInfo?.color || '#999', lastSeen: Date.now() });

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    lanState.broadcastChannel.postMessage({
      type: 'webrtc-offer',
      from: lanState.user.id,
      to: peerId,
      data: offer
    });
  } catch (err) {
    console.error('创建 offer 失败:', err);
  }
}

async function handleOffer(peerId, offer) {
  if (lanState.peers.has(peerId)) return;

  const { pc, dc } = createPeerConnection(peerId);
  lanState.peers.set(peerId, { pc, dc, name: '未知', color: '#999', lastSeen: Date.now() });

  try {
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    lanState.broadcastChannel.postMessage({
      type: 'webrtc-answer',
      from: lanState.user.id,
      to: peerId,
      data: answer
    });
  } catch (err) {
    console.error('处理 offer 失败:', err);
  }
}

async function handleAnswer(peerId, answer) {
  const peer = lanState.peers.get(peerId);
  if (peer && peer.pc.signalingState === 'have-local-offer') {
    await peer.pc.setRemoteDescription(answer);
  }
}

async function handleIceCandidate(peerId, candidate) {
  const peer = lanState.peers.get(peerId);
  if (peer) {
    await peer.pc.addIceCandidate(candidate);
  }
}

/* ============ DataChannel 消息处理 ============ */
function setupDataChannel(dc, peerId) {
  dc.onopen = () => {
    console.log('DataChannel 已连接:', peerId);
    renderLanMembers();
  };

  dc.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleLanMessage(msg, peerId);
    } catch (e) {
      console.error('解析消息失败:', e);
    }
  };

  dc.onclose = () => {
    lanState.peers.delete(peerId);
    renderLanMembers();
  };
}

function handleLanMessage(msg, peerId) {
  const peer = lanState.peers.get(peerId);
  if (peer) {
    peer.lastSeen = Date.now();
    if (msg.name) peer.name = msg.name;
    if (msg.color) peer.color = msg.color;
  }

  switch (msg.type) {
    case 'chat':
      addLanMessage({
        id: msg.id || Date.now().toString(),
        userId: msg.userId,
        name: msg.name,
        color: msg.color,
        content: msg.content,
        time: msg.time || new Date().toISOString(),
        isMe: msg.userId === lanState.user.id
      });
      break;
    case 'typing':
      showLanTyping(msg.name);
      break;
    case 'history':
      // 收到历史消息（新用户加入时同步）
      if (msg.messages) {
        msg.messages.forEach(m => addLanMessage({ ...m, isMe: m.userId === lanState.user.id }));
      }
      break;
  }
}

/* ============ 发送消息 ============ */
function broadcastLanMessage(msg) {
  const data = JSON.stringify({ ...msg, userId: lanState.user.id, name: lanState.user.name, color: lanState.user.color });
  lanState.peers.forEach((peer, peerId) => {
    if (peer.dc && peer.dc.readyState === 'open') {
      peer.dc.send(data);
    }
  });
}

/* ============ UI 渲染 ============ */
let lanDom = null;

function initLanChat(container) {
  container.innerHTML = `
    <div class="lan-chat">
      <header class="lan-header">
        <div class="lan-title">
          <span class="lan-icon">🎱</span>
          <div>
            <div class="lan-name">台球室聊天室</div>
            <div class="lan-status">● 局域网模式 · <span id="lanPeerCount">0</span> 人在线</div>
          </div>
        </div>
        <button class="lan-exit-btn" id="lanExitBtn" title="退出">✕</button>
      </header>
      <div class="lan-messages" id="lanMessages"></div>
      <div class="lan-typing" id="lanTyping"></div>
      <div class="lan-composer">
        <div class="lan-composer-inner">
          <button class="lan-emoji-btn" id="lanEmojiBtn" title="表情">😊</button>
          <textarea id="lanInput" class="lan-input" rows="1" placeholder="发消息… (Enter 发送)"></textarea>
          <button class="lan-send-btn" id="lanSendBtn" title="发送">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 12L21 3L13 21L11 13L3 12Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div id="lanEmojiPanel" class="emoji-panel hidden">
      <div class="ep-grid" id="lanEmojiGrid"></div>
    </div>
  `;

  lanDom = {
    messages: $('lanMessages'),
    input: $('lanInput'),
    sendBtn: $('lanSendBtn'),
    emojiBtn: $('lanEmojiBtn'),
    emojiPanel: $('lanEmojiPanel'),
    emojiGrid: $('lanEmojiGrid'),
    typing: $('lanTyping'),
    peerCount: $('lanPeerCount'),
    exitBtn: $('lanExitBtn'),
  };

  // 绑定事件
  lanDom.sendBtn.addEventListener('click', sendLanMessage);
  lanDom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendLanMessage();
    }
  });
  lanDom.input.addEventListener('input', handleLanTyping);
  lanDom.emojiBtn.addEventListener('click', toggleLanEmojiPanel);
  lanDom.exitBtn.addEventListener('click', exitLanChat);

  document.addEventListener('click', (e) => {
    if (!lanDom.emojiPanel.contains(e.target) && e.target !== lanDom.emojiBtn) {
      lanDom.emojiPanel.classList.add('hidden');
    }
  });

  // 渲染表情
  LAN_EMOJIS.forEach(emoji => {
    const span = document.createElement('span');
    span.className = 'ep-item';
    span.textContent = emoji;
    span.addEventListener('click', () => {
      lanDom.input.value += emoji;
      lanDom.input.focus();
      lanDom.emojiPanel.classList.add('hidden');
    });
    lanDom.emojiGrid.appendChild(span);
  });

  // 启动信令
  initLanSignaling();

  // 定期清理断开的 peer
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    lanState.peers.forEach((peer, peerId) => {
      if (now - peer.lastSeen > 30000) {
        lanState.peers.delete(peerId);
        changed = true;
      }
    });
    if (changed) renderLanMembers();
  }, 10000);
}

function sendLanMessage() {
  const text = lanDom.input.value.trim();
  if (!text) return;

  const msg = {
    type: 'chat',
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    content: text,
    time: new Date().toISOString(),
  };

  broadcastLanMessage(msg);
  addLanMessage({ ...msg, userId: lanState.user.id, name: lanState.user.name, color: lanState.user.color, isMe: true });
  lanDom.input.value = '';
  lanDom.input.style.height = 'auto';
}

function handleLanTyping() {
  if (lanState.typingTimer) clearTimeout(lanState.typingTimer);
  if (!lanState.isTyping) {
    lanState.isTyping = true;
    broadcastLanMessage({ type: 'typing' });
  }
  lanState.typingTimer = setTimeout(() => {
    lanState.isTyping = false;
  }, 2000);
}

function showLanTyping(name) {
  lanDom.typing.textContent = `${name} 正在输入…`;
  setTimeout(() => {
    if (lanDom.typing.textContent === `${name} 正在输入…`) {
      lanDom.typing.textContent = '';
    }
  }, 3000);
}

function addLanMessage(msg) {
  // 去重
  if (lanState.messageEls.has(msg.id)) return;

  const div = document.createElement('div');
  div.className = 'lan-msg' + (msg.isMe ? ' me' : '');
  const time = new Date(msg.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    <div class="lan-msg-avatar" style="background:${msg.color}">${msg.name[0].toUpperCase()}</div>
    <div class="lan-msg-body">
      <div class="lan-msg-meta">
        <span class="lan-msg-name">${escapeHtml(msg.name)}</span>
        <span class="lan-msg-time">${time}</span>
      </div>
      <div class="lan-msg-content">${escapeHtml(msg.content)}</div>
    </div>
  `;
  lanDom.messages.appendChild(div);
  lanState.messageEls.set(msg.id, div);
  lanDom.messages.scrollTop = lanDom.messages.scrollHeight;
}

function renderLanMembers() {
  if (lanDom && lanDom.peerCount) {
    lanDom.peerCount.textContent = lanState.peers.size;
  }
}

function toggleLanEmojiPanel() {
  lanDom.emojiPanel.classList.toggle('hidden');
}

function exitLanChat() {
  // 关闭所有连接
  lanState.peers.forEach(peer => {
    if (peer.dc) peer.dc.close();
    if (peer.pc) peer.pc.close();
  });
  lanState.peers.clear();
  if (lanState.broadcastChannel) {
    lanState.broadcastChannel.close();
  }
  // 返回模式选择
  showModeSelector();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
