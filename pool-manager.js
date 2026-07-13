/* ============================================================
 *  台球室管理面板 — 计时计费 / 排队叫号 / 积分系统
 * ============================================================ */

const poolDom = {
  poolManageBtn:    document.getElementById('poolManageBtn'),
  poolManagerModal: document.getElementById('poolManagerModal'),
  poolManagerClose: document.getElementById('poolManagerClose'),
  poolTablesGrid:   document.getElementById('poolTablesGrid'),
  poolQueueList:    document.getElementById('poolQueueList'),
  poolJoinQueueBtn: document.getElementById('poolJoinQueueBtn'),
  myScoreValue:     document.getElementById('myScoreValue'),
  scoreLeaderboard: document.getElementById('scoreLeaderboard'),
};

const poolState = {
  tables: [],
  queue: [],
  scores: [],
  timerInterval: null,
};

/* ============ 初始化 ============ */
function initPoolManager() {
  if (!poolDom.poolManageBtn) return;

  poolDom.poolManageBtn.addEventListener('click', openPoolManager);
  poolDom.poolManagerClose.addEventListener('click', closePoolManager);
  poolDom.poolJoinQueueBtn.addEventListener('click', joinQueue);

  // 标签切换
  document.querySelectorAll('.pool-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchPoolTab(tab.dataset.tab);
    });
  });

  poolDom.poolManagerModal.addEventListener('click', (e) => {
    if (e.target === poolDom.poolManagerModal) closePoolManager();
  });
}

function openPoolManager() {
  poolDom.poolManagerModal.classList.remove('hidden');
  switchPoolTab('tables');
  loadPoolTables();
  loadQueue();
  loadScores();
  startTimerUpdate();
}

function closePoolManager() {
  poolDom.poolManagerModal.classList.add('hidden');
  stopTimerUpdate();
}

function switchPoolTab(tab) {
  document.querySelectorAll('.pool-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.pool-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('pool' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Panel');
  if (panel) panel.classList.remove('hidden');
}

/* ============ 台球桌管理 ============ */
async function loadPoolTables() {
  if (!window.state || !window.state.supabase) return;
  const { data } = await window.state.supabase.from('pool_tables').select('*').order('id');
  poolState.tables = data || [];
  renderPoolTables();
}

function renderPoolTables() {
  poolDom.poolTablesGrid.innerHTML = '';
  if (poolState.tables.length === 0) {
    poolDom.poolTablesGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#999;padding:20px;">暂无台球桌</div>';
    return;
  }
  poolState.tables.forEach(table => {
    const isOccupied = table.status === 'occupied';
    const card = document.createElement('div');
    card.className = 'pool-table-card ' + (isOccupied ? 'occupied' : 'idle');

    let timerHtml = '';
    if (isOccupied && table.started_at) {
      const elapsed = Math.floor((Date.now() - new Date(table.started_at).getTime()) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const cost = ((elapsed / 3600) * (table.rate_per_hour || 30)).toFixed(1);
      timerHtml = `
        <div class="pt-timer" data-started="${table.started_at}" data-rate="${table.rate_per_hour || 30}">
          ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}
        </div>
        <div class="pt-player">${escapeHtml(table.player_name || '未知')}</div>
        <div class="pt-status">已消费 ¥${cost}</div>
      `;
    } else {
      timerHtml = `
        <div class="pt-timer">--:--</div>
        <div class="pt-status">${table.rate_per_hour || 30}元/小时</div>
      `;
    }

    const btnText = isOccupied ? '结账' : '开台';
    const btnClass = isOccupied ? 'end' : 'start';
    const isOwner = isOccupied && table.player_id === (window.state?.user?.id);
    const isAdmin = window.state?.currentChannel?.owner_id === window.state?.user?.id;
    const canEnd = isOccupied && (isOwner || isAdmin);

    card.innerHTML = `
      <div class="pt-name">${escapeHtml(table.name)}</div>
      ${timerHtml}
      ${!isOccupied ? `<button class="pt-btn start" data-id="${table.id}">开台</button>` : ''}
      ${canEnd ? `<button class="pt-btn end" data-id="${table.id}">结账</button>` : ''}
    `;

    const startBtn = card.querySelector('.pt-btn.start');
    if (startBtn) startBtn.addEventListener('click', () => startTable(table.id));
    const endBtn = card.querySelector('.pt-btn.end');
    if (endBtn) endBtn.addEventListener('click', () => endTable(table.id));

    poolDom.poolTablesGrid.appendChild(card);
  });
}

async function startTable(tableId) {
  if (!window.state?.user) return;
  const { error } = await window.state.supabase.from('pool_tables').update({
    status: 'occupied',
    player_id: window.state.user.id,
    player_name: window.state.user.name,
    started_at: new Date().toISOString(),
  }).eq('id', tableId);
  if (error) { alert('开台失败: ' + error.message); return; }
  loadPoolTables();
}

async function endTable(tableId) {
  const table = poolState.tables.find(t => t.id === tableId);
  if (!table || !table.started_at) return;
  const elapsedHours = (Date.now() - new Date(table.started_at).getTime()) / 3600000;
  const cost = (elapsedHours * (table.rate_per_hour || 30)).toFixed(1);
  if (!confirm(`确定结账？\n用时: ${elapsedHours.toFixed(1)} 小时\n费用: ¥${cost}`)) return;

  // 给使用者增加积分（消费1元=1积分）
  if (table.player_id) {
    await addScore(table.player_id, table.player_name || '未知', Math.floor(parseFloat(cost)), '台球消费');
  }

  const { error } = await window.state.supabase.from('pool_tables').update({
    status: 'idle',
    player_id: null,
    player_name: null,
    started_at: null,
  }).eq('id', tableId);
  if (error) { alert('结账失败: ' + error.message); return; }
  loadPoolTables();
  loadScores();
}

function startTimerUpdate() {
  stopTimerUpdate();
  poolState.timerInterval = setInterval(() => {
    document.querySelectorAll('.pt-timer[data-started]').forEach(el => {
      const started = new Date(el.dataset.started).getTime();
      const rate = parseFloat(el.dataset.rate) || 30;
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      el.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      // 更新费用显示
      const cost = ((elapsed / 3600) * rate).toFixed(1);
      const statusEl = el.parentElement.querySelector('.pt-status');
      if (statusEl) statusEl.textContent = `已消费 ¥${cost}`;
    });
  }, 1000);
}

function stopTimerUpdate() {
  if (poolState.timerInterval) {
    clearInterval(poolState.timerInterval);
    poolState.timerInterval = null;
  }
}

/* ============ 排队管理 ============ */
async function loadQueue() {
  if (!window.state || !window.state.supabase) return;
  const { data } = await window.state.supabase
    .from('table_queue')
    .select('*')
    .eq('status', 'waiting')
    .order('queued_at', { ascending: true });
  poolState.queue = data || [];
  renderQueue();
}

function renderQueue() {
  poolDom.poolQueueList.innerHTML = '';
  if (poolState.queue.length === 0) {
    poolDom.poolQueueList.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无排队</div>';
    return;
  }
  poolState.queue.forEach((q, idx) => {
    const item = document.createElement('div');
    item.className = 'pool-queue-item';
    const time = new Date(q.queued_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const isMe = q.user_id === window.state?.user?.id;
    item.innerHTML = `
      <div class="pq-name">
        <span style="font-weight:700;color:var(--primary);width:24px;">${idx + 1}</span>
        <span>${escapeHtml(q.user_name || '未知')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="pq-time">${time}</span>
        ${isMe ? '<button class="pq-cancel" title="取消排队">✕</button>' : ''}
      </div>
    `;
    const cancelBtn = item.querySelector('.pq-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => cancelQueue(q.id));
    poolDom.poolQueueList.appendChild(item);
  });
}

async function joinQueue() {
  if (!window.state?.user) return;
  // 检查是否已在排队
  const existing = poolState.queue.find(q => q.user_id === window.state.user.id);
  if (existing) { alert('你已经在排队中了'); return; }

  const { error } = await window.state.supabase.from('table_queue').insert({
    user_id: window.state.user.id,
    user_name: window.state.user.name,
  });
  if (error) { alert('排队失败: ' + error.message); return; }
  loadQueue();
}

async function cancelQueue(queueId) {
  const { error } = await window.state.supabase
    .from('table_queue')
    .delete()
    .eq('id', queueId);
  if (error) { alert('取消失败: ' + error.message); return; }
  loadQueue();
}

/* ============ 积分系统 ============ */
async function loadScores() {
  if (!window.state || !window.state.supabase) return;
  const { data } = await window.state.supabase
    .from('customer_scores')
    .select('*')
    .order('points', { ascending: false })
    .limit(20);
  poolState.scores = data || [];
  renderScores();
}

function renderScores() {
  // 我的积分
  const myScore = poolState.scores.find(s => s.user_id === window.state?.user?.id);
  poolDom.myScoreValue.textContent = myScore ? myScore.points : 0;

  // 排行榜
  poolDom.scoreLeaderboard.innerHTML = '';
  if (poolState.scores.length === 0) {
    poolDom.scoreLeaderboard.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无积分记录</div>';
    return;
  }
  poolState.scores.forEach((s, idx) => {
    const item = document.createElement('div');
    item.className = 'score-item';
    item.innerHTML = `
      <span class="score-rank">${idx + 1}</span>
      <span class="score-name">${escapeHtml(s.user_name || '未知')}</span>
      <span class="score-points">${s.points} 分</span>
    `;
    poolDom.scoreLeaderboard.appendChild(item);
  });
}

async function addScore(userId, userName, points, reason) {
  if (!window.state?.supabase) return;
  // 先查询现有积分
  const { data: existing } = await window.state.supabase
    .from('customer_scores')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) {
    await window.state.supabase.from('customer_scores').update({
      points: existing.points + points,
      total_spent: (existing.total_spent || 0) + points,
      user_name: userName,
    }).eq('id', existing.id);
  } else {
    await window.state.supabase.from('customer_scores').insert({
      user_id: userId,
      user_name: userName,
      points: points,
      total_spent: points,
    });
  }

  // 记录积分变动
  await window.state.supabase.from('score_history').insert({
    user_id: userId,
    change: points,
    reason: reason,
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
window.addEventListener('DOMContentLoaded', initPoolManager);
