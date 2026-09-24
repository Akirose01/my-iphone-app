/* Lovera · 智能体聊天 网页版 */
"use strict";

const COLORS = ["#8F6FB6", "#B27BB8", "#7E9BD1", "#6FB6A8", "#C9A15B",
                "#C96A9B", "#5B8FB0", "#9B7BB8", "#C96A6A", "#5FA97A"];
const LS_KEY = "lovera_web_data";
const isMobile = window.matchMedia("(max-width: 720px)").matches;

let state = loadState();
let currentId = null;
let editingId = null;
let tempAvatarB64 = "";
let tempUserAvatarB64 = "";
let selectedColor = COLORS[0];
let generating = false;
let abortCtl = null;

const $ = (sel) => document.querySelector(sel);
function showModal(id) { const el = document.getElementById(id); if (el) { el.hidden = false; el.style.display = "flex"; } }
function hideModal(id) { const el = document.getElementById(id); if (el) { el.hidden = true; el.style.display = "none"; } }

/* ---------------- 状态持久化 ---------------- */
function defaultState() {
  return {
    settings: {
      api_key: "", base_url: "https://api.deepseek.com", proxy: "",
      model: "deepseek-chat",
      temperature: 0.7, max_tokens: 4096, stream: true,
      user_name: "", user_bio: "", avatar: "", wallpaper: "", wallpaperEnabled: true,
      wallpaperOpacity: 0,
      safetyPrompt: false        // 默认不注入任何"行为准则"（私人对话，不套模板）
    },
    agents: [],
    moments: []
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    return { settings: Object.assign(defaultState().settings, s.settings), agents: s.agents || [], moments: s.moments || [] };
  } catch (e) { return defaultState(); }
}
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    // 配额爆了（常见于把大图 base64 塞进 localStorage）——说清楚原因，别默默失败
    const big = [];
    if (state.settings.wallpaper) big.push("壁纸");
    if (state.settings.avatar) big.push("头像");
    toast("浏览器本地存储已满" + (big.length ? "（" + big.join("、") + "占用过大）" : "")
      + "：图片请用「上传」由本地服务保存原图，不要存在浏览器里");
    return false;
  }
}
function agents() { return state.agents; }
function getAgent(id) { return agents().find(a => a.id === id); }
function agentModel(a) { return (a.model || "").trim() || state.settings.model; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function now() { return Date.now(); }
function fmtTime(ts) { const d = new Date(ts); return d.toTimeString().slice(0, 5); }

/* ---------------- 工具：头像 / 缩略图 ---------------- */
function avatarHTML(a) {
  if (a.avatar_img) return `<img src="data:image/png;base64,${a.avatar_img}" alt="">`;
  const ch = (a.avatar || (a.name ? a.name[0] : "?")) || "?";
  return `<span>${esc(ch)}</span>`;
}
function _isUserRole(r) { return String(r || "").toLowerCase() === "user"; }

/* ---------- 极简 Markdown 渲染（离线，不依赖任何库） ----------
   顺序很重要：先把代码块抠出来 → 再转义 → 再做行内/行级替换 → 最后把代码块放回去。
   这样代码里的 * _ # 之类不会被当成格式。 */
/* ---------- 极简 Markdown 渲染（离线，不依赖任何库） ----------
   顺序很重要：先把代码块抠出来 → 再转义 → 再做行内/行级替换 → 最后把代码块放回去。
   这样代码里的 * _ # 之类不会被当成格式。 */

/* 代码块「复制」按钮：事件委托，只装一次 —— md-copy 点击 */
document.addEventListener("click", function (e) {
  const btn = e.target && e.target.closest ? e.target.closest("[data-md-copy]") : null;
  if (!btn) return;
  const box = btn.closest(".md-block");
  const code = box ? box.querySelector("code") : null;
  if (!code) return;
  const text = code.innerText || code.textContent || "";
  const done = () => { const o = btn.textContent; btn.textContent = "已复制 ✓";
                       setTimeout(() => { btn.textContent = o || "复制"; }, 1200); };
  const fail = () => { btn.textContent = "复制失败"; };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (x) { fail(); }
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); done(); document.body.removeChild(ta);
    }
  } catch (err) { fail(); }
});

function mdToHtml(src) {
  let t = String(src == null ? "" : src).replace(/\r\n?/g, "\n");
  const blocks = [];
  t = t.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    const body = esc(code.replace(/\n+$/, ""));
    blocks.push(
      '<div class="md-block">' +
        '<div class="md-block-bar"><span class="md-lang">' + esc(lang || "code") + "</span>" +
        '<button class="md-copy" type="button" data-md-copy>复制</button></div>' +
        '<pre class="md-pre"><code>' + body + "</code></pre>" +
      "</div>");
    return "\u0000" + (blocks.length - 1) + "\u0000";
  });
  t = esc(t);
  t = t.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
  t = t.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
       .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
       .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
       .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
       .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
       .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
       .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
       .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 表格：连续的 | a | b | 行
  t = t.replace(/(?:^|\n)(\|[^\n]*\|(?:\n\|[^\n]*\|)+)/g, (m, tbl) => {
    const rows = tbl.trim().split("\n").map((r) => r.trim());
    if (rows.length < 2) return m;
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const isSep = (r) => /^\|[\s:|-]+\|$/.test(r);
    let html = '<table class="md-table"><thead><tr>' +
      cells(rows[0]).map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>";
    for (let i = 1; i < rows.length; i++) {
      if (isSep(rows[i])) continue;
      html += "<tr>" + cells(rows[i]).map((c) => "<td>" + c + "</td>").join("") + "</tr>";
    }
    return "\n" + html + "</tbody></table>";
  });
  t = t.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  t = t.replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, "<hr>");
  t = t.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");
  t = t.replace(/^(\s*)[-*+]\s+(.+)$/gm, "$1<li>$2</li>")
       .replace(/^(\s*)\d+[.)]\s+(.+)$/gm, "$1<li>$2</li>");
  t = t.replace(/(?:^|\n)((?:[^\n]*<li>[\s\S]*?<\/li>[^\n]*\n?)+)/g,
                (m, run) => "\n<ul>" + run.trim() + "</ul>");
  t = t.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
  t = t.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[+i] || "");
  return t;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function userAvatarHTML() {
  const av = state.settings.avatar;
  return av ? `<img src="data:image/png;base64,${av}" alt="">` : `<span>我</span>`;
}
function readImageAsB64(file, maxDim, cb, mime, quality) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, 0, 0, w, h);
    // 照片用 JPEG 有损压缩，体积能小一个数量级（PNG 会把 localStorage 撑爆）
    const dataUrl = mime === "image/jpeg" ? cv.toDataURL("image/jpeg", quality || 0.9)
                                          : cv.toDataURL("image/png");
    cb(dataUrl.split(",")[1] || "");
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("图片读取失败"); };
  img.src = url;
}

/* ---------------- 启动页 ---------------- */
function initSplash() {
  const splash = $("#splash");
  setTimeout(() => {
    splash.classList.add("hide");
    setTimeout(() => { splash.style.display = "none"; }, 650);
  }, 2200);
}

/* ---------------- 侧边栏 / 智能体列表 ---------------- */
let batchMode = false;
let selectedIds = new Set();

function renderAgentList() {
  const list = $("#agentList");
  list.innerHTML = "";
  const ags = agents();
  if (!ags.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.innerHTML = batchMode ? "没有可删除的智能体。" : "还没有智能体。<br>点上方「＋ 新建智能体」创建一个，<br>输入人设就能聊起来。";
    list.appendChild(empty);
    return;
  }
  for (const a of ags) {
    const item = document.createElement("div");
    item.className = "agent-item" + (a.id === currentId ? " active" : "");
    const last = a.messages.length ? a.messages[a.messages.length - 1].content
               : (a.greeting || "点击开始对话");
    const cb = batchMode ? `<input type="checkbox" class="selbox" data-id="${a.id}" ${selectedIds.has(a.id) ? "checked" : ""}>` : "";
    item.innerHTML = `${cb}
      <div class="avatar" style="background:${a.color}">${avatarHTML(a)}</div>
      <div class="texts">
        <div class="name">${esc(a.name)}</div>
        <div class="last">${esc(last.replace(/\n/g, " ").slice(0, 22))}</div>
      </div>`;
    if (batchMode) {
      const cbEl = item.querySelector(".selbox");
      cbEl.addEventListener("change", () => {
        if (cbEl.checked) selectedIds.add(a.id); else selectedIds.delete(a.id);
      });
      item.onclick = (e) => {
        if (e.target !== cbEl) { cbEl.checked = !cbEl.checked; cbEl.dispatchEvent(new Event("change")); }
      };
    } else {
      item.onclick = () => selectAgent(a.id);
    }
    list.appendChild(item);
    if (!a.avatar_img) item.querySelector(".avatar").style.background = a.color;
  }
  $("#delSelectedBtn").textContent = `删除选中${selectedIds.size ? "（" + selectedIds.size + "）" : ""}`;
}

function selectAgent(id) {
  currentId = id;
  renderAgentList();
  renderChat();
  if (isMobile) $("#sidebar").classList.remove("open");
  if (typeof showTab === "function") showTab("chat");   // 选完人回到消息页
}
function backToSidebar() { $("#sidebar").classList.add("open"); }

function toggleBatch() {
  batchMode = !batchMode;
  selectedIds = new Set();
  $("#batchBtn").hidden = batchMode;
  $("#delSelectedBtn").hidden = !batchMode;
  $("#cancelBatchBtn").hidden = !batchMode;
  renderAgentList();
}
function deleteSelected() {
  if (selectedIds.size === 0) { toast("请先勾选要删除的智能体"); return; }
  if (!confirm(`确定删除选中的 ${selectedIds.size} 个智能体及其聊天记录吗？`)) return;
  state.agents = agents().filter(a => !selectedIds.has(a.id));
  if (selectedIds.has(currentId)) currentId = null;
  saveState();
  renderAgentList(); renderChat();
  toggleBatch();
  toast("已删除选中智能体");
}

/* ---------------- 聊天渲染 ---------------- */
function renderChat() {
  const a = getAgent(currentId);
  const box = $("#messages");
  box.innerHTML = "";
  if (!a) {
    $("#chatName").textContent = "Lovera";
    // 手机上侧边栏是抽屉、藏在左上角那个「‹」后面，所以别说"从左侧选择"
    $("#chatSub").textContent = window.innerWidth < 700
      ? "点左上角那个箭头，选一个智能体开始聊天"
      : "从左侧选择一个智能体开始聊天，或新建一个";
    $("#chatAvatar").innerHTML = `<span>L</span>`;
    $("#chatAvatar").style.background = "#9678B4";
    $("#chatAvatar").style.fontWeight = "bold";
    box.innerHTML = `<div class="empty-list" style="margin:auto">`
      + (window.innerWidth < 700 ? "点左上角箭头选人开始<br>（第一次用就点它）" : "欢迎使用 Lovera")
      + `</div>`;
    return;
  }
  $("#chatName").textContent = a.name;
  $("#chatSub").textContent = a.persona ? (a.persona.length > 40 ? a.persona.slice(0, 40) + "…" : a.persona) : "自由对话";
  $("#chatAvatar").innerHTML = avatarHTML(a);
  $("#chatAvatar").style.background = a.avatar_img ? "#fff" : a.color;
  if (a.avatar_img) $("#chatAvatar").innerHTML = `<img src="data:image/png;base64,${a.avatar_img}" alt="">`;

  let prevTs = null;
  const n = a.messages.length;
  for (let i = 0; i < n; i++) {
    const m = a.messages[i];
    if (prevTs === null || m.timestamp - prevTs > 10 * 60 * 1000) {
      box.appendChild(timeGap(fmtTime(m.timestamp)));
    }
    prevTs = m.timestamp;
    box.appendChild(bubble(a, m, i === n - 1 && m.role === "assistant"));
  }
  box.scrollTop = box.scrollHeight;
}
function timeGap(t) { const d = document.createElement("div"); d.className = "time-gap"; d.textContent = t; return d; }
function bubble(a, m, isLastAgent) {
  const wrap = document.createElement("div");
  const role = m.role;
  wrap.className = "msg " + (role === "user" ? "user" : "agent");
  if (m.recalled) {
    wrap.className += " recalled";
    wrap.innerHTML = `<div class="recall-notice">${role === "user" ? "你撤回了一条消息" : "对方撤回了一条消息"}</div>`;
    return wrap;
  }
  const av = `<div class="avatar" style="background:${role === "user" ? (state.settings.avatar ? "#fff" : "#7E9BD1") : a.color}">${
    role === "user" ? userAvatarHTML() : avatarHTML(a)}</div>`;
  const t = m.timestamp ? `<span class="time">${fmtTime(m.timestamp)}</span>` : "";
  const recall = role === "user" ? `<button class="recall" data-id="${m.id}">撤回</button>` : "";
  const acts = (role === "assistant")
    ? `<span class="msg-actions">${isLastAgent
        ? `<button class="act-btn regen">重说</button><button class="act-btn cont">继续</button>` : ""}` +
      `<button class="act-btn say" title="念给我听">🔊</button></span>`
    : "";
  const pics = (m.images || []).map((u) =>
    `<img class="msg-img" src="${esc(u)}" alt="图片" loading="lazy">`).join("");
  wrap.innerHTML = `${av}<div class="bubble ${_isUserRole(role) ? "mine" : "md"}">${pics}${_isUserRole(role) ? esc(m.content) : mdToHtml(m.content)}</div>${acts}${recall}${t}`;
  if (role === "assistant") {
    const sb = wrap.querySelector(".say");
    if (sb) sb.addEventListener("click", () => {
      const playing = sb.textContent === "⏸";
      if (playing) { stopSpeaking(); sb.textContent = "🔊"; }
      else { stopSpeaking(); speakText(m.content); sb.textContent = "⏸"; }
    });
  }
  if (role === "assistant" && isLastAgent) {
    wrap.querySelector(".regen").addEventListener("click", () => regenerate(a.id));
    wrap.querySelector(".cont").addEventListener("click", () => continueChat(a.id));
  }
  if (role === "user") {
    const rbtn = wrap.querySelector(".recall");
    rbtn.addEventListener("click", () => recall(a.id, m.id));
    // 移动端：长按显示“撤回”
    let timer = null;
    wrap.addEventListener("touchstart", () => {
      timer = setTimeout(() => wrap.classList.add("show-recall"), 450);
    }, { passive: true });
    wrap.addEventListener("touchend", () => {
      clearTimeout(timer);
      setTimeout(() => wrap.classList.remove("show-recall"), 1500);
    });
    wrap.addEventListener("touchcancel", () => clearTimeout(timer));
    // 桌面端：右键也可撤回
    wrap.addEventListener("contextmenu", (e) => { e.preventDefault(); recall(a.id, m.id); });
  }
  return wrap;
}
function recall(agentId, msgId) {
  const a = getAgent(agentId);
  if (!a) return;
  const msg = a.messages.find(x => x.id === msgId);
  if (!msg || msg.recalled) return;
  // 若撤回的是正在生成的那一条，停止生成
  if (msg.role === "user" && generating && abortCtl) {
    const last = a.messages[a.messages.length - 1];
    if (last && last.id === msgId) { abortCtl.abort(); generating = false; $("#sendBtn").hidden = false; $("#stopBtn").hidden = true; }
  }
  msg.recalled = true;
  saveState(); renderChat(); renderAgentList();
  // 撤回也要写回电脑。只改手机本地的话，8 秒后的同步会把这条原样刷回来。
  const q = tokenQuery();
  fetch("/api/recall" + (q ? "?" + q : ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: a.name, role: msg.role, content: msg.content,
                           timestamp: msg.timestamp }),
  }).catch(() => {});
  toast("已撤回");
}
function appendLive(a, role, content) {
  const box = $("#messages");
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "agent");
  const av = `<div class="avatar" style="background:${role === "user" ? (state.settings.avatar ? "#fff" : "#7E9BD1") : a.color}">${
    role === "user" ? userAvatarHTML() : avatarHTML(a)}</div>`;
  wrap.innerHTML = `${av}<div class="bubble"></div>`;
  wrap.querySelector(".bubble").textContent = content;
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
  return wrap.querySelector(".bubble");
}

/* ---------------- 构建发送给模型的消息 ---------------- */
/* 这段「行为准则」默认**不再注入**（这是你自己的私人对话，不该被套话术模板）。
   想开回来：浏览器里 localStorage 的 settings 里把 safetyPrompt 设成 true 即可。
   原文留在这里，不是删掉。 */
const SAFETY_PROMPT = "行为准则：① 如果用户要求你说攻击、伤害或贬低他人的话，请委婉地拒绝，并照顾用户的情绪，给出温和的建议；" +
  "② 如果用户无缘无故辱骂、攻击你本人，你可以礼貌而坚定地回应（甚至反击），不要一味委屈自己或无条件讨好。";

/* ---------------- 风格守则 / few-shot 样本 ----------------
   与桌面版同一套机制：按智能体名字去 persona/ 目录取两个文件
     persona/<名字>_风格守则.md  → 作为 system 注入（量化的语气硬指标 + 禁止清单）
     persona/<名字>_样本.json    → few-shot 逐字样本（user/assistant 成对）
   文件不存在就自动跳过，行为与原来一致。 */
const STYLE_CACHE = {};
/* ================= 危险信号：手机上弹求助卡，号码点一下就拨 =================
   为什么手机这一头最重要：电脑上弹再大的字也打不了电话，
   而手机上 tel: 链接点一下就直接拨出去。 */
const CRISIS_LINES = [
  ["110", "报警（有立即危险 / 已经受伤）"],
  ["120", "急救（吃了药、受了伤、叫不醒——先打 120）"],
  ["12356", "全国心理援助热线（24 小时，免费）"],
  ["010-82951332", "心理危机干预中心（24 小时）"],
  ["400-161-9995", "希望24热线（24 小时）"],
];

function showCrisisCard(level) {
  if (document.getElementById("crisisCard")) return;
  const box = document.createElement("div");
  box.id = "crisisCard";
  box.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(60,20,20,.55);"
    + "display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto";
  const inner = document.createElement("div");
  inner.style.cssText = "background:#FFF6F6;border-radius:16px;padding:18px;max-width:520px;"
    + "width:100%;box-shadow:0 8px 30px rgba(0,0,0,.3);font-family:inherit";
  let html = '<div style="font-size:19px;font-weight:700;color:#B03A3A;margin-bottom:6px">'
    + "这些电话是真的有人接的</div>"
    + '<div style="color:#7A5B5B;font-size:14px;line-height:1.7;margin-bottom:12px">'
    + "我（Lovera）陪着你说话，但这件事得由真的人来做。<br>"
    + "点号码就直接拨——不用组织语言，说「我需要帮助」就行。打不通就换下一个。</div>";
  for (const [num, desc] of CRISIS_LINES) {
    html += '<a href="tel:' + num.replace(/[^0-9+]/g, "") + '" style="display:flex;'
      + "justify-content:space-between;align-items:center;background:#fff;border:1px solid #F0D5D5;"
      + 'border-radius:12px;padding:12px 14px;margin:8px 0;text-decoration:none;color:inherit">'
      + '<span style="font-size:22px;font-weight:700;color:#B03A3A">' + num + "</span>"
      + '<span style="font-size:12px;color:#7A5B5B;text-align:right;max-width:62%">' + desc + "</span></a>";
  }
  html += '<div style="color:#9A8080;font-size:12px;line-height:1.6;margin-top:10px">'
    + "给家人、朋友、医生里任何一个打个电话也行——比跟我说话有用。<br>"
    + "（这张卡是我看到你那句话里不太对劲，自动弹出来的。）</div>"
    + '<button id="crisisClose" style="margin-top:14px;width:100%;padding:12px;border:0;'
    + 'border-radius:12px;background:#EFE8F7;color:#4A3A5A;font-size:15px">我知道了，关掉</button>';
  inner.innerHTML = html;
  box.appendChild(inner);
  document.body.appendChild(box);
  const btn = document.getElementById("crisisClose");
  if (btn) btn.onclick = () => box.remove();
}

function stripMd(t) {  return t.replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("```"))
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n").trim();
}

/* ================= 让他开口说话（手机自带语音，不依赖电脑） =================
   用的是浏览器自带的中文语音（Web Speech API），免费、不用电脑开着。
   语气照电脑版那套思路来：开头的括号动作决定语速/音调，说话时把括号丢掉
   （括号是演给你看的，不该被念出来）。 */
const TTS = { on: false, voice: null, rate: 1.0, pitch: 1.0 };

function ttsSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function ttsPickVoice() {
  if (!ttsSupported()) return null;
  const vs = speechSynthesis.getVoices() || [];
  // 优先中文女声，其次任意中文
  const zh = vs.filter(v => /zh|Chinese|中文|普通话/i.test(v.lang + " " + v.name));
  if (!zh.length) return null;
  const prefer = ["xiaoxiao", "xiaoyi", "huihui", "yaoyao", "female", "女", "Tingting", "Mei"];
  for (const p of prefer) {
    const hit = zh.find(v => v.name.toLowerCase().includes(p.toLowerCase()));
    if (hit) return hit;
  }
  return zh[0];
}

/* 情绪 → 语速/音调（照电脑版的关键词分档） */
const PHONE_EMO = [
  { key: "soft",   re: /小声|轻声|柔声|放轻|压低|低低|轻轻/, rate: 0.90, pitch: 0.96 },
  { key: "low",    re: /沉默|叹气|叹了|低沉|闷|累|疲惫/, rate: 0.88, pitch: 0.92 },
  { key: "laugh",  re: /笑|调侃|打趣|挑眉|嗤|咧嘴|哼笑/, rate: 1.07, pitch: 1.10 },
  { key: "angry",  re: /凶|火|吼|咬牙|瞪/, rate: 1.10, pitch: 0.98 },
  { key: "hurry",  re: /急|快|连忙|赶紧|催/, rate: 1.10, pitch: 1.04 },
  { key: "gentle", re: /温柔|温声|耐心|安抚|哄/, rate: 0.93, pitch: 1.02 },
  { key: "serious", re: /正色|认真|严肃/, rate: 0.98, pitch: 0.98 },
];
const BASE_TONE = { key: "", rate: 1.0, pitch: 1.0 };

function toneOf(dir) {
  const s = String(dir || "").slice(0, 30);
  for (const e of PHONE_EMO) if (e.re.test(s)) return e;
  return BASE_TONE;
}

/* 把一段话按括号切成若干"带语气的小段"。
   语义跟电脑版一致：**括号管它后面那段**。不同语气不合并（合并就把语气差吃掉了）。 */
function ttsSegments(raw) {
  let t = String(raw || "")
    .replace(/\[\[\s*action\s*:[^\]]*\]\]/g, "")     // 操作指令标记
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s*/g, "");
  const parts = [];
  const re = /[（(]([^）)]{0,40})[）)]/g;
  let m, last = 0, dir = "";
  while ((m = re.exec(t)) !== null) {
    const seg = t.slice(last, m.index);
    if (seg.replace(/\s/g, "")) parts.push({ dir: dir, text: seg });
    dir = m[1];
    last = re.lastIndex;
  }
  const tail = t.slice(last);
  if (tail.replace(/\s/g, "")) parts.push({ dir: dir, text: tail });
  if (!parts.length) parts.push({ dir: "", text: t });

  const merged = [];
  for (const p of parts) {
    const tone = toneOf(p.dir);
    const prev = merged[merged.length - 1];
    if (prev && prev.key === tone.key &&
        (p.text.length < 14 || prev.text.length < 14)) {
      prev.text += p.text;
    } else {
      merged.push({ key: tone.key, rate: tone.rate, pitch: tone.pitch, text: p.text });
    }
  }
  while (merged.length > 4) {                 // 段数上限：太多段手机念起来会有停顿
    const x = merged.pop();
    merged[merged.length - 1].text += x.text;
  }
  return merged
    .map(s => ({ rate: s.rate, pitch: s.pitch,
                 text: s.text.replace(/[*_`>#]/g, "").replace(/\s{2,}/g, " ").trim() }))
    .filter(s => s.text);
}

function speakText(raw) {
  if (!ttsSupported()) { toast("这个浏览器不支持语音朗读"); return false; }
  const segs = ttsSegments(raw);
  if (!segs.length) return false;
  try { speechSynthesis.cancel(); } catch (e) {}
  const v = TTS.voice || ttsPickVoice();
  if (v) TTS.voice = v;
  const setBtn = (t) => { const b = $("#speakBtn"); if (b) b.textContent = t; };
  segs.forEach((s, i) => {
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = (v && v.lang) || "zh-CN";
    if (v) u.voice = v;
    u.rate = s.rate;        // 每段自己的语气
    u.pitch = s.pitch;
    if (i === segs.length - 1) u.onend = () => setBtn(TTS.on ? "🔊" : "🔈");
    try { speechSynthesis.speak(u); } catch (e) { toast("语音播放失败"); return false; }
  });
  setBtn("⏸");
  return true;
}

function stopSpeaking() {
  if (!ttsSupported()) return;
  try { speechSynthesis.cancel(); } catch (e) {}
  const b = $("#speakBtn");
  if (b) b.textContent = TTS.on ? "🔊" : "🔈";
}

function speakLast() {
  const a = getAgent(currentId);
  if (!a) return;
  for (let i = a.messages.length - 1; i >= 0; i--) {
    if (a.messages[i].role === "assistant" && a.messages[i].content) {
      speakText(a.messages[i].content);
      return;
    }
  }
  toast("还没有他的话可以念");
}

/* 初始化朗读开关（开关状态存在手机本地，下次打开还记得） */
function initSpeak() {
  const btn = $("#speakBtn");
  if (!btn) return;
  try { TTS.on = localStorage.getItem("lovera_tts") === "1"; } catch (e) {}
  btn.textContent = TTS.on ? "🔊" : "🔈";
  btn.title = TTS.on ? "自动朗读：开（点一下关掉）" : "自动朗读：关（点一下打开）";
  if (ttsSupported()) ttsPickVoice();
  btn.addEventListener("click", () => {
    TTS.on = !TTS.on;
    try { localStorage.setItem("lovera_tts", TTS.on ? "1" : "0"); } catch (e) {}
    btn.textContent = TTS.on ? "🔊" : "🔈";
    btn.title = TTS.on ? "自动朗读：开（点一下关掉）" : "自动朗读：关（点一下打开）";
    toast(TTS.on ? "自动朗读已打开：他以后每条都会念出来" : "自动朗读已关。想听某一条就点那条上的 🔊");
    if (TTS.on) speakLast(); else stopSpeaking();
  });
  // 手机上「自动朗读」按钮之外，长按任一气泡也能念那一条（由 bubble() 挂的 🔊 负责）
}
async function loadStyle(name) {
  if (STYLE_CACHE[name] !== undefined) return STYLE_CACHE[name];
  const out = { guard: "", shots: [] };
  try {
    const r = await fetch("persona/" + encodeURIComponent(name) + "_风格守则.md", { cache: "no-store" });
    if (r.ok) out.guard = stripMd(await r.text());
  } catch (e) { /* 没有就当没有 */ }
  try {
    const r2 = await fetch("persona/" + encodeURIComponent(name) + "_样本.json", { cache: "no-store" });
    if (r2.ok) {
      const j = await r2.json();
      out.shots = Array.isArray(j) ? j : [].concat.apply([], Object.values(j));
    }
  } catch (e) { /* 同上 */ }
  STYLE_CACHE[name] = out;
  return out;
}

const HISTORY_ROUNDS = 20;   // 只带最近 20 轮，避免上下文无限增长

/* ---------------- 与电脑端共用同一份聊天记录 ----------------
   本地服务在跑时：手机这边的读和写都落到电脑上那份数据文件，
   所以两边看到的是同一段对话，不再各存各的。
   服务不在（例如部署在 Netlify）时自动退回浏览器本地存储。 */
let serverSync = false;

function tokenQuery() {
  const q = (location.search || "").replace(/^\?/, "");   // "k=xxx" 或 ""
  if (q) {
    // 顺手把口令记下来：装到手机桌面之后是从 start_url("./") 启动的，
    // 地址栏里没有 ?k= —— 不记住的话，装出来的 App 一打开全是 403。
    try { localStorage.setItem("lovera_k", q); } catch (e) {}
    return q;
  }
  try { return localStorage.getItem("lovera_k") || ""; } catch (e) { return ""; }
}

async function syncHistory(a, _retried) {
  if (!a || generating) return false;
  const q = tokenQuery();
  try {
    const r = await fetch("/api/history?agent=" + encodeURIComponent(a.name) + (q ? "&" + q : ""),
                          { cache: "no-store" });
    if (!r.ok) return false;
    const d = await r.json();
    let msgs = (d.messages || []).map((m) => ({
      role: m.role,
      content: m.content || "",
      timestamp: (m.timestamp < 1e11 ? m.timestamp * 1000 : m.timestamp),   // 秒 → 毫秒
      recalled: !!m.recalled,
      // 电脑上发的图片：本地服务按 /media/desktop_<文件名> 提供
      images: (m.images || []).map((n) => "/media/desktop_" + encodeURIComponent(n)),
    }));

    // 第一次连上时：把「本地独有的消息」先推上去，别让它被电脑的记录顶掉
    if (!serverSync && !_retried) {
      const key = (m) => m.role + "|" + (m.content || "").slice(0, 60);
      const have = new Set(msgs.map(key));
      const localOnly = (a.messages || []).filter(
        (m) => (m.role === "user" || m.role === "assistant") && !have.has(key(m)) && (m.content || "").trim()
      );
      if (localOnly.length) {
        for (const m of localOnly) {
          await pushMessage(a, m.role, m.content, m.timestamp || Date.now());
        }
        toast("已把本地 " + localOnly.length + " 条记录并入电脑");
        return syncHistory(a, true);      // 推完再拉一次
      }
    }

    const sig = (arr) => JSON.stringify(arr.map((m) => [m.role, m.content, Math.round(m.timestamp || 0)]));
    if (sig(msgs) !== sig(a.messages)) {
      a.messages = msgs;
      saveState();
      renderChat();
      renderAgentList();
    }
    serverSync = true;
    return true;
  } catch (e) {
    return false;
  }
}

async function pushMessage(a, role, content, ts, images) {
  const q = tokenQuery();
  try {
    const r = await fetch("/api/append" + (q ? "?" + q : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: a.name, role: role, content: content,
                             timestamp: ts, images: images || [] }),
    });
    // 必须看返回值：服务端写盘失败时（锁残留、文件被占用）回的是 ok:false，
    // 而紧接着 syncHistory 会用服务端历史覆盖本地 —— 那条没写进去的消息就永久没了。
    let ok = r.ok;
    if (ok) {
      try { const j = await r.json(); ok = !(j && j.ok === false); } catch (e) { ok = true; }
    }
    if (!ok) queueResend(a.name, role, content, ts, images);
  } catch (e) {
    queueResend(a.name, role, content, ts, images);   // 服务不在：等它回来再补发
  }
}

/* 没写进电脑的消息先攒着，稍后重发；同步时也不会被服务端历史覆盖掉 */
const PENDING = [];
function queueResend(agent, role, content, ts, images) {
  if (PENDING.some(p => p.content === content && p.agent === agent)) return;
  PENDING.push({ agent, role, content, timestamp: ts, images: images || [], tries: 0 });
  toast("这条还没写进电脑，我过会儿重发");
}

async function flushPending() {
  if (!PENDING.length) return;
  const q = tokenQuery();
  for (const p of PENDING.slice()) {
    try {
      const r = await fetch("/api/append" + (q ? "?" + q : ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: p.agent, role: p.role, content: p.content,
                               timestamp: p.timestamp, images: p.images }),
      });
      if (r.ok) PENDING.splice(PENDING.indexOf(p), 1);
      else p.tries++;
    } catch (e) { p.tries++; }
    if (p.tries > 20) PENDING.splice(PENDING.indexOf(p), 1);
  }
}

/* 手机上发图片：上传到电脑 → 让"眼睛"看一眼 → 写进两边记录 → 生成回复 */
async function sendImageFile(file) {
  const a = getAgent(currentId);
  if (!a) { toast("请先选择一个智能体"); return; }
  if (generating) { toast("他还在说，稍等一下"); return; }
  const q = tokenQuery();
  const caption = $("#input").value.trim();
  $("#input").value = "";
  toast("正在上传图片…");

  let up;
  try {
    const r = await fetch("/api/media/chat" + (q ? "?" + q : ""), {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name || ""),
      },
      body: file,
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    up = await r.json();
    if (!up.file) throw new Error(up.error || "服务端没返回文件名");
  } catch (e) {
    toast("图片上传失败：" + e.message + "（本机服务没开？）");
    return;
  }

  let content = caption;
  try {
    const rv = await fetch("/api/vision" + (q ? "?" + q : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: up.file, hint: caption }),
    });
    const d = await rv.json();
    if (d && d.text) {
      content = "【你看到的图片内容】" + d.text + (caption ? "\n" + caption : "");
    } else if (d && d.error) {
      content = (d.configured === false ? "（你还没配「眼睛」，看不到图里的内容）"
                                        : "（这张图没看清：" + d.error + "）")
              + (caption ? "\n" + caption : "");
    }
  } catch (e) { /* 没有视觉就只发图 */ }

  a.messages.push({ role: "user", content: content, timestamp: now(), id: uid(),
                    images: [up.url] });
  saveState();
  pushMessage(a, "user", content, now(), [up.file]);
  renderChat();
  renderAgentList();
  runGeneration(a);
}

function buildMessages(a, style) {
  const msgs = [];
  const s = state.settings;
  const uparts = [];
  if (s.user_name.trim()) uparts.push("用户称呼：" + s.user_name.trim());
  if (s.user_bio.trim()) uparts.push("用户简介：" + s.user_bio.trim());
  if (uparts.length) msgs.push({ role: "system", content: "你在和一位用户对话。\n" + uparts.join("\n") });
  if (state.settings.safetyPrompt) msgs.push({ role: "system", content: SAFETY_PROMPT });
  if (a.persona.trim()) msgs.push({ role: "system", content: a.persona.trim() });

  // 风格守则（量化语气） + few-shot 逐字样本
  if (style) {
    if (style.guard) msgs.push({ role: "system", content: style.guard });
    if (style.shots && style.shots.length) {
      msgs.push({
        role: "system",
        content: "接下来是「" + a.name + "」平时说话的样例，用来校准你的语气和节奏："
          + "照它的节奏说话，不要复述、不要提及这些样例的存在。",
      });
      let n = 0;
      for (const it of style.shots) {
        if (n >= 24) break;
        const u = String(it.user || "").trim(), asst = String(it.assistant || "").trim();
        if (!asst) continue;
        if (u) { msgs.push({ role: "user", content: u }); n++; }
        msgs.push({ role: "assistant", content: asst }); n++;
      }
    }
  }

  // 历史：只留最近 HISTORY_ROUNDS 轮，且不以孤立的 assistant 开头
  let history = a.messages.slice();
  if (history.length && history[0].role === "assistant" && history[0].content === a.greeting) history = history.slice(1);
  const keep = [];
  let seenUser = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "user") { seenUser++; if (seenUser > HISTORY_ROUNDS) break; }
    keep.unshift(m);
  }
  if (keep.length && keep[0].role === "assistant") keep.shift();
  for (const m of keep) if (!m.recalled && (m.role === "user" || m.role === "assistant")) msgs.push({ role: m.role, content: m.content });

  if (!msgs.length) msgs.push({ role: "user", content: "你好，请介绍一下你自己。" });
  return msgs;
}

/* ---------------- 发送 & 流式 API ---------------- */
async function chatStream(settings, model, msgs, temperature, maxTokens, signal, onDelta) {
  let resp;
  const useProxy = (settings.proxy || "").trim();
  let url;
  let headers = { "Content-Type": "application/json" };
  let bodyData;
  if (useProxy) {
    url = settings.proxy.trim();
    headers["Authorization"] = "Bearer " + settings.api_key;
    bodyData = JSON.stringify({
      model, messages: msgs, temperature, max_tokens: maxTokens, stream: !!settings.stream,
      _upstream: { base_url: settings.base_url, api_key: settings.api_key }
    });
  } else {
    url = settings.base_url.replace(/\/+$/, "") + "/chat/completions";
    headers["Authorization"] = "Bearer " + settings.api_key;
    bodyData = JSON.stringify({ model, messages: msgs, temperature, max_tokens: maxTokens, stream: !!settings.stream });
  }
  try {
    resp = await fetch(url, { method: "POST", signal, headers, body: bodyData });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("__aborted__");
    throw new Error("无法连接服务器（可能是跨域 CORS 或网络问题）。\n请在设置里把接口地址换成支持跨域的地址，或填入已部署的代理地址（见 README）。");
  }
  if (!resp.ok) {
    let txt = ""; try { txt = (await resp.text()).slice(0, 400); } catch (e) {}
    throw new Error(`请求失败（HTTP ${resp.status}）：${txt || explainHttp(resp.status)}`);
  }
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  const isSSE = ct.includes("text/event-stream");
  // 危险信号：电脑那边在响应头里说了"她这句话不对劲"——手机这边立刻弹卡，
  // 因为**能一键拨号的只有手机**，电脑弹卡没用。
  const crisis = resp.headers.get("X-Lovera-Crisis");
  if (crisis) { try { showCrisisCard(crisis); } catch (e) {} }
  // 纯 JSON 返回（非流式 / 代理）：直接解析，若解析失败则回退为原文本
  if ((ct.includes("application/json") && !isSSE) || !resp.body) {
    const text = await resp.text();
    try {
      const d = JSON.parse(text);
      var _c1 = d && d.choices && d.choices[0];
      return (_c1 && _c1.message && _c1.message.content) || text;
    } catch (e) {
      return text;
    }
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buffer = "", full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const p = s.slice(5).trim();
      if (p === "[DONE]") return full;
      try {
        const j = JSON.parse(p);
        const _c2 = j && j.choices && j.choices[0];
        const d = (_c2 && _c2.delta && _c2.delta.content) || "";
        if (d) { full += d; onDelta(d); }
      } catch (e) {}
    }
  }
  return full;
}
function explainHttp(c) {
  return { 400: "请求参数有误", 401: "API Key 无效或未授权", 402: "账户额度不足",
           403: "无权访问", 404: "接口地址/模型不存在", 429: "请求过于频繁，请稍后再试",
           500: "服务端错误", 503: "服务端暂不可用" }[c] || "未知错误";
}

function sendChat() {
  if (generating) return;
  const a = getAgent(currentId);
  if (!a) { toast("请先选择一个智能体"); return; }
  const text = $("#input").value.trim();
  if (!text) return;
  $("#input").value = "";
  a.messages.push({ role: "user", content: text, timestamp: now(), id: uid() });
  saveState();
  pushMessage(a, "user", text, now());      // 同步到电脑那份记录
  renderAgentList();
  renderChat();
  runGeneration(a);
}

async function runGeneration(a, extraSystem) {
  if (generating) return;
  generating = true;
  abortCtl = new AbortController();
  $("#sendBtn").hidden = true;
  $("#stopBtn").hidden = false;

  const style = await loadStyle(a.name);     // 守则 + few-shot（没有就是空的）
  const msgs = buildMessages(a, style);
  if (extraSystem) msgs.push(extraSystem);  // 追加的不落库指令（例如“继续”）

  const live = appendLive(a, "assistant", "");
  let acc = "";
  chatStream(state.settings, agentModel(a), msgs,
             (a.temperature != null ? a.temperature : state.settings.temperature), state.settings.max_tokens,
             abortCtl.signal, (d) => { acc += d; live.textContent = acc; scrollBottom(); })
    .then((full) => {
      let text2 = (acc || full || "").trim();
      if (abortCtl.signal.aborted) text2 = text2 + "\n\n[已停止生成]";
      if (!text2) text2 = "(空回复)";
      a.messages.push({ role: "assistant", content: text2, timestamp: now() });
      saveState();
      pushMessage(a, "assistant", text2, now());   // 同步到电脑那份记录
      renderChat(); renderAgentList();
      if (TTS.on && !abortCtl.signal.aborted) speakText(text2);   // 手机自带语音念出来
      if (state.settings.autoSpeak) speakText(text2);             // 电脑端设置里也开了就跟着念
    })
    .catch((e) => {
      if (e.message !== "__aborted__") {
        a.messages.push({ role: "assistant", content: "[出错了] " + e.message, timestamp: now() });
        saveState(); renderChat();
      }
    })
    .finally(() => {
      generating = false;
      $("#sendBtn").hidden = false;
      $("#stopBtn").hidden = true;
    });
}

// 重说：删掉上一条 AI 回复，重新生成（针对同一提问）
function regenerate(agentId) {
  if (generating) return;
  const a = getAgent(agentId);
  if (!a) return;
  const last = a.messages[a.messages.length - 1];
  if (!last || last.role !== "assistant") { toast("还没有可重说的回复"); return; }
  const lastIdx = a.messages.findIndex(x => x === last);
  a.messages.splice(lastIdx, 1);
  saveState(); renderChat(); renderAgentList();
  runGeneration(a);
}

// 继续：让 AI 接着上一条回复继续写
function continueChat(agentId) {
  if (generating) return;
  const a = getAgent(agentId);
  if (!a) return;
  const last = a.messages[a.messages.length - 1];
  if (!last || last.role !== "assistant") { toast("请先让智能体回复一次再继续"); return; }
  runGeneration(a, { role: "system", content: "请接着你上一条回复自然往下写，继续补充，不要重复已说过的内容。" });
}
function toastFromCors(full, text) {
  // 若返回文本里带有跨域提示，用 toast 提示用户
  if (/跨域|CORS|无法连接/.test(text)) toast("提示：如跨域拦截，请在设置里改用支持跨域的接口地址或代理。");
}
function scrollBottom() { const box = $("#messages"); box.scrollTop = box.scrollHeight; }
function stopGenerating() { if (abortCtl) abortCtl.abort(); }

/* ---------------- 智能体弹窗 ---------------- */
function openAgentModal(agent) {
  editingId = agent ? agent.id : null;
  tempAvatarB64 = agent ? (agent.avatar_img || "") : "";
  selectedColor = agent ? (COLORS.includes(agent.color) ? agent.color : COLORS[0]) : COLORS[0];
  $("#agentModalTitle").textContent = agent ? "编辑智能体" : "新建智能体";
  $("#agentName").value = agent ? agent.name : "";
  $("#agentAvatar").value = agent ? (agent.avatar || "") : "";
  $("#agentPersona").value = agent ? (agent.persona || "") : "";
  $("#agentGreeting").value = agent ? (agent.greeting || "") : "";
  $("#agentModel").value = agent ? (agent.model || "") : "";
  const t = agent ? agent.temperature : 0.7;
  $("#agentTemp").value = t; $("#agentTempVal").textContent = "：" + t;
  $("#agentDeleteBtn").hidden = !agent;
  drawSwatches();
  drawAvatarPreview();
  showModal("agentModal");
}
function closeAgentModal() { hideModal("agentModal"); }
function drawSwatches() {
  const box = $("#colorSwatches");
  box.innerHTML = "";
  for (const c of COLORS) {
    const b = document.createElement("div");
    b.className = "swatch" + (c === selectedColor ? " sel" : "");
    b.style.background = c;
    b.onclick = () => { selectedColor = c; drawSwatches(); drawAvatarPreview(); };
    box.appendChild(b);
  }
}
function drawAvatarPreview() {
  const cv = $("#avatarPreview"), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, 72, 72);
  if (tempAvatarB64) {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.beginPath(); ctx.arc(36, 36, 34, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, 0, 0, 72, 72); ctx.restore();
    };
    img.src = "data:image/png;base64," + tempAvatarB64;
    return;
  }
  const ch = ($("#agentAvatar").value.trim() || (editingId ? getAgent(editingId).name[0] : "?")) || "?";
  ctx.fillStyle = selectedColor;
  ctx.beginPath(); ctx.arc(36, 36, 32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ch, 36, 38);
}
function saveAgent() {
  const name = $("#agentName").value.trim();
  if (!name) { toast("请填写智能体名字"); return; }
  const a = editingId ? getAgent(editingId) : { id: uid(), created: now(), messages: [] };
  if (!a) { toast("智能体不存在"); return; }
  a.name = name;
  a.avatar = $("#agentAvatar").value.trim();
  a.avatar_img = tempAvatarB64;
  a.color = selectedColor;
  a.persona = $("#agentPersona").value.trim();
  a.greeting = $("#agentGreeting").value.trim();
  a.model = $("#agentModel").value.trim();
  a.temperature = parseFloat($("#agentTemp").value);
  if (!editingId) {
    if (a.greeting) a.messages = [{ role: "assistant", content: a.greeting, timestamp: now() }];
    state.agents.push(a);
  }
  saveState();
  currentId = a.id;
  renderAgentList(); renderChat();
  closeAgentModal();
  toast("已保存");
}
function deleteAgent() {
  if (!editingId) return;
  const a = getAgent(editingId);
  if (!confirm(`确定删除「${a.name}」及其全部聊天记录吗？`)) return;
  state.agents = state.agents.filter(x => x.id !== editingId);
  if (currentId === editingId) currentId = null;
  saveState(); renderAgentList(); renderChat(); closeAgentModal();
}

/* ---------------- 设置弹窗 ---------------- */
function openSettings() {
  const s = state.settings;
  $("#apiKey").value = s.api_key;
  $("#baseUrl").value = s.base_url;
  $("#proxy").value = s.proxy || "";
  $("#model").value = s.model;
  $("#maxTokens").value = s.max_tokens;
  $("#temperature").value = s.temperature;
  $("#stream").checked = s.stream;
  $("#userName").value = s.user_name;
  $("#userBio").value = s.user_bio;
  tempUserAvatarB64 = s.avatar || "";
  drawUserAvatarPreview();
  $("#wallpaperEnabled").checked = s.wallpaperEnabled;
  const wpOp = s.wallpaperOpacity == null ? 0 : s.wallpaperOpacity;
  $("#wallpaperOpacity").value = wpOp;
  $("#wallpaperOpacityVal").textContent = wpOp + "%";
  showModal("settingsModal");
}
function drawUserAvatarPreview() {
  const cv = $("#userAvatarPreview"), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, 72, 72);
  if (tempUserAvatarB64) {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.beginPath(); ctx.arc(36, 36, 34, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(img, 0, 0, 72, 72); ctx.restore();
    };
    img.src = "data:image/png;base64," + tempUserAvatarB64;
    return;
  }
  ctx.fillStyle = "#7E9BD1";
  ctx.beginPath(); ctx.arc(36, 36, 32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("我", 36, 38);
}
function closeSettings() { hideModal("settingsModal"); applyWallpaper(); }
function saveSettings() {
  const s = state.settings;
  s.api_key = $("#apiKey").value.trim();
  s.base_url = $("#baseUrl").value.trim() || s.base_url;
  s.proxy = $("#proxy").value.trim();
  s.model = $("#model").value.trim() || s.model;
  s.max_tokens = parseInt($("#maxTokens").value, 10) || 4096;
  s.temperature = parseFloat($("#temperature").value) || 0.7;
  s.stream = $("#stream").checked;
  s.user_name = $("#userName").value.trim();
  s.user_bio = $("#userBio").value.trim();
  s.avatar = tempUserAvatarB64 || "";
  s.wallpaperEnabled = $("#wallpaperEnabled").checked;
  const trVal = parseInt($("#wallpaperOpacity").value, 10);
  s.wallpaperOpacity = isNaN(trVal) ? 0 : trVal;
  saveState(); applyWallpaper(); renderChat(); closeSettings(); toast("设置已保存");
}
async function testConnection() {
  const url = $("#baseUrl").value.trim() || state.settings.base_url;
  const key = $("#apiKey").value.trim();
  const model = $("#model").value.trim() || state.settings.model;
  if (!key) { toast("请先填写 API Key"); return; }
  toast("正在测试连接…");
  const sig = new AbortController();
  const timer = setTimeout(() => sig.abort(), 20000);
  try {
    const out = await chatStream({ base_url: url, api_key: key, proxy: $("#proxy").value.trim(), stream: false }, model,
      [{ role: "user", content: "ping" }], 0, 8, sig.signal, () => {});
    clearTimeout(timer); toast("✓ 连接成功：" + (out || "(空)").slice(0, 30));
  } catch (e) {
    clearTimeout(timer);
    toast("✗ 连接失败：" + (e.message.length > 60 ? e.message.slice(0, 60) + "…" : e.message));
  }
}

/* ---------------- 壁纸 / 头像上传 ----------------
   优先走本地服务：原图直接落盘，浏览器只存一个网址 →
   既不会被 localStorage 的 5MB 配额卡住，也不会被压缩，铺满屏幕是真高清。
   没有本地服务时才退回 base64（用 JPEG 有损压小，避免配额爆炸）。 */
async function uploadMedia(slot, file) {
  const q = location.search || "";
  const r = await fetch("/api/media/" + slot + q, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name || "") },
    body: file,
  });
  if (!r.ok) throw new Error("服务端拒绝了上传（" + r.status + "）");
  const j = await r.json();
  if (!j.url) throw new Error("服务端没返回网址");
  return j;
}
function applyWallpaper() {
  const w = $("#wallpaper");
  const s = state.settings;
  // wallpaperOpacity 是“透明度” 0-100：0=背景可见，100=完全透明(无背景)
  const tr = (s.wallpaperOpacity == null ? 0 : s.wallpaperOpacity);
  const src = s.wallpaperUrl ? s.wallpaperUrl : (s.wallpaper ? "data:image/png;base64," + s.wallpaper : "");
  if (s.wallpaperEnabled && src && tr < 100) {
    w.style.backgroundImage = `url("${src}")`;
    w.style.opacity = 1 - tr / 100;
  } else {
    w.style.backgroundImage = "";
    w.style.opacity = 1;
  }
}

/* 旧数据迁移：把浏览器里那张巨大的 base64 壁纸搬到服务端，腾出 localStorage */
async function offloadBigWallpaper() {
  const s = state.settings;
  if (!s.wallpaper || s.wallpaperUrl) return;
  if (s.wallpaper.length < 700 * 1024) return;      // 小于 ~500KB 原图就不用折腾
  try {
    const bin = atob(s.wallpaper);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const blob = new Blob([buf], { type: "image/png" });
    const j = await uploadMedia("wallpaper", new File([blob], "wallpaper.png", { type: "image/png" }));
    s.wallpaperUrl = j.url;
    s.wallpaper = "";                               // 关键：释放配额
    saveState();
    applyWallpaper();
    toast("大图已移到本地服务，浏览器存储已释放");
  } catch (e) { /* 没有本地服务就算了 */ }
}

/* ---------------- 导出 / 导入 ---------------- */
function download(name, content, type) {
  const blob = new Blob([content], { type: type || "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportData() {
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16).replace(/-/g, "");
  download(`Lovera备份_${ts}.json`, JSON.stringify(state, null, 2));
  toast("已导出备份文件");
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      const mode = confirm("选择导入方式\n确定=合并（保留现有，覆盖同名）\n取消=整体替换（清空现有数据）") ? "merge" : "replace";
      if (mode === "replace") {
        state = Object.assign(defaultState(), incoming);
        if (!state.settings) state.settings = defaultState().settings;
        if (!state.agents) state.agents = [];
      } else {
        const map = {}; agents().forEach(a => map[a.id] = a);
        (incoming.agents || []).forEach(a => { map[a.id] = a; });
        state.agents = Object.values(map);
        state.settings = Object.assign(defaultState().settings, state.settings, incoming.settings || {});
      }
      saveState(); applyWallpaper(); renderAgentList(); renderChat();
      toast("导入完成");
    } catch (e) { toast("导入失败：" + e.message); }
  };
  reader.readAsText(file);
}

/* ---------------- AI 朋友圈 ---------------- */
function agentById(id) { return agents().find(a => a.id === id); }
function momentById(id) { return state.moments.find(p => p.id === id); }

async function askOne(a, prompt) {
  const msgs = [];
  if (a.persona.trim()) msgs.push({ role: "system", content: a.persona.trim() });
  msgs.push({ role: "user", content: prompt });
  try {
    return await chatStream(state.settings, agentModel(a), msgs,
      (a.temperature != null ? a.temperature : state.settings.temperature), 160, new AbortController().signal, () => {});
  } catch (e) {
    return "（生成失败）";
  }
}

let autoBusy = false;   // 防止多次自动生成重叠
async function autoMoments() {
  if (autoBusy) return;
  if (agents().length === 0) { toast("请先创建智能体，AI 才能自动发"); return; }
  autoBusy = true;
  // 随机选一个智能体当作者，让它自己写一条
  const author = agents()[Math.floor(Math.random() * agents().length)];
  toast(author.name + " 正在发朋友圈…");
  const content = await askOne(author, "请作为你自己，随意发一条朋友圈动态（30 字以内，口语化、有个性，只输出正文）。");
  const post = { id: uid(), agentId: author.id, content: content || ("这是" + author.name + "的碎碎念"), time: now(), likes: [], comments: [] };
  state.moments.unshift(post);
  saveState(); renderMoments();

  // 再让最多 2 个其它智能体自动点赞 + 评论（AI 互相看到）
  const others = agents().filter(a => a.id !== author.id).slice(0, 2);
  for (const c of others) {
    if (!post.likes.includes(c.id)) post.likes.push(c.id);
    const comment = await askOne(c, `请对这条朋友圈点评一句（20 字内，口语化、有人设个性）：\n「${post.content}」`);
    post.comments.push({ id: uid(), who: "agent", agentId: c.id, content: comment, time: now() });
    saveState(); renderMoments();
  }
  autoBusy = false;
  toast("已自动发布，AI 们已互动");
}

function openMoments() {
  $("#chatpanePane").style.display = "none";
  const mv = $("#momentsView");
  mv.hidden = false; mv.style.display = "flex";
  renderMoments();
  autoMoments();   // 每次打开自动让 AI 发一条
}
function closeMoments() {
  const mv = $("#momentsView");
  mv.hidden = true; mv.style.display = "none";
  $("#chatpanePane").style.display = "flex";
  renderChat();
}

function renderMoments() {
  const feed = $("#momentsFeed");
  feed.innerHTML = "";
  const ms = state.moments.slice().sort((x, y) => y.time - x.time);
  if (!ms.length) {
    feed.innerHTML = `<div class="empty-list" style="margin:auto">还没有动态。<br>点右上角「发朋友圈」让智能体发一条吧。</div>`;
    return;
  }
  for (const post of ms) {
    const author = agentById(post.agentId);
    const av = author ? avatarHTML(author) : `<span>?</span>`;
    const avBg = author ? author.color : "#9678B4";
    post.likes = post.likes || [];
    post.comments = post.comments || [];
    const likedByUser = post.likes.includes("user");
    const likeNames = post.likes.map(id => id === "user" ? "我" : (agentById(id) ? agentById(id).name : ""))
                      .filter(Boolean);
    const likeLabel = post.likes.length ? `❤️ ${post.likes.length}（${likeNames.join("、")}）` : "点赞";
    const card = document.createElement("div");
    card.className = "post";
    card.innerHTML = `
      <div class="post-head">
        <div class="avatar" style="background:${avBg}">${av}</div>
        <div class="post-meta">
          <div class="post-name">${esc(author ? author.name : "已删除")}</div>
          <div class="post-time">${fmtTime(post.time)}</div>
        </div>
      </div>
      <div class="post-content">${esc(post.content)}</div>
      <div class="post-actions">
        <button class="act-btn like-btn">${likeLabel}</button>
        <button class="act-btn interact-btn">AI 互动</button>
        <button class="act-btn comment-btn">评论</button>
      </div>
      <div class="post-comments">${
        post.comments.map(c => {
          const ca = c.agentId ? agentById(c.agentId) : null;
          const name = c.who === "user" ? "我" : (ca ? ca.name : "AI");
          return `<div class="comment"><b>${esc(name)}：</b>${esc(c.content)}</div>`;
        }).join("")
      }</div>`;
    card.querySelector(".like-btn").addEventListener("click", () => toggleLike(post.id));
    card.querySelector(".interact-btn").addEventListener("click", () => openCommentModal(post.id, "ai"));
    card.querySelector(".comment-btn").addEventListener("click", () => openCommentModal(post.id, "user"));
    feed.appendChild(card);
  }
}

function openPostModal() {
  const sel = $("#postAgent");
  sel.innerHTML = "";
  agents().forEach(a => { const o = document.createElement("option"); o.value = a.id; o.textContent = a.name; sel.appendChild(o); });
  if (currentId && getAgent(currentId)) sel.value = currentId;
  $("#postContent").value = "";
  showModal("postModal");
}
async function postAutoGen() {
  const a = agentById($("#postAgent").value);
  if (!a) { toast("请先选择智能体"); return; }
  $("#postContent").value = "（生成中…）";
  const content = await askOne(a, "请以你自己的身份，写一条短短的朋友圈动态（30 字左右，口语化、有个性，只输出正文）。");
  $("#postContent").value = content;
}
function publishPost() {
  const a = agentById($("#postAgent").value);
  if (!a) { toast("请选择智能体"); return; }
  const content = $("#postContent").value.trim();
  if (!content) { toast("内容为空"); return; }
  state.moments.unshift({ id: uid(), agentId: a.id, content, time: now(), likes: [], comments: [] });
  saveState(); renderMoments(); hideModal("postModal"); toast("已发布");
}

let commentPostId = null;
function openCommentModal(postId, mode) {
  commentPostId = postId;
  const sel = $("#commentAgent");
  sel.innerHTML = "";
  agents().forEach(a => { const o = document.createElement("option"); o.value = a.id; o.textContent = a.name; sel.appendChild(o); });
  $("#userCommentText").value = "";
  showModal("commentModal");
  if (mode === "user") { try { $("#userCommentText").focus(); } catch (e) {} }
}
function toggleLike(postId) {
  const post = momentById(postId);
  if (!post) return;
  post.likes = post.likes || [];
  const i = post.likes.indexOf("user");
  if (i >= 0) post.likes.splice(i, 1); else post.likes.push("user");
  saveState(); renderMoments();
}
async function aiInteract() {
  const post = momentById(commentPostId);
  const a = agentById($("#commentAgent").value);
  if (!post) return;
  if (!a) { toast("请选择智能体"); return; }
  toast("让 " + a.name + " 点赞并评论…");
  post.likes = post.likes || [];
  if (!post.likes.includes(a.id)) post.likes.push(a.id);
  const c = await askOne(a, `请对这条朋友圈点评一句（20 字内，口语化、有你的人设个性）：\n「${post.content}」`);
  post.comments.push({ id: uid(), who: "agent", agentId: a.id, content: c, time: now() });
  saveState(); renderMoments(); hideModal("commentModal"); toast("已互动");
}
async function userComment() {
  const post = momentById(commentPostId);
  if (!post) return;
  const text = $("#userCommentText").value.trim();
  if (!text) { toast("先写点内容"); return; }
  post.comments.push({ id: uid(), who: "user", content: text, time: now() });
  saveState(); renderMoments();
  hideModal("commentModal");
  const author = agentById(post.agentId);
  if (author) {
    toast("正在回复你的评论…");
    const reply = await askOne(author, `用户在你的朋友圈下评论了：「${text}」。请回复一句（自然、简短、呼应对方）。`);
    post.comments.push({ id: uid(), who: "agent", agentId: author.id, content: reply, time: now() });
    saveState(); renderMoments();
  }
}

/* ---------------- 界面绑定 ---------------- */
function bindEvents() {
  // 侧边栏
  $("#newAgentBtn").onclick = () => openAgentModal(null);
  $("#settingsBtn").onclick = openSettings;
  $("#backBtn").onclick = backToSidebar;
  $("#editBtn").onclick = () => { const a = getAgent(currentId); if (a) openAgentModal(a); else toast("请先选择智能体"); };
  $("#clearBtn").onclick = () => {
    const a = getAgent(currentId);
    if (!a || !a.messages.length) return;
    if (confirm(`确定清空「${a.name}」的聊天记录吗？`)) {
      // 必须让电脑那边也清空。只清手机本地的话，8 秒后同步会把记录整份拉回来
      //（看起来就是"清空了又自己回来"）。
      const q = tokenQuery();
      const done = () => { a.messages = []; a.clearedAt = now(); saveState(); renderChat(); toast("已清空"); };
      fetch("/api/clear" + (q ? "?" + q : ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: a.name }),
      }).then((r) => {
        if (r.ok) done();
        else toast("电脑那边没清掉（口令或服务有问题），先没动你这边的记录");
      }).catch(() => toast("连不上电脑，清空没做成——先看看电脑上的服务还开着吗"));
    }
  };

  // 发送
  $("#sendBtn").onclick = sendChat;
  // 发图片（手机上拍照/相册选图 → 传到电脑 → 他用自己的语气回）
  if ($("#imgBtn")) $("#imgBtn").onclick = () => $("#chatImgInput").click();
  if ($("#chatImgInput")) {
    $("#chatImgInput").addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) sendImageFile(f);
    });
  }
  $("#stopBtn").onclick = stopGenerating;
  $("#input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // 智能体弹窗
  $("#agentSaveBtn").onclick = saveAgent;
  $("#agentCancelBtn").onclick = closeAgentModal;
  $("#agentDeleteBtn").onclick = deleteAgent;
  $("#uploadAvatarBtn").onclick = () => $("#avatarFileInput").click();
  $("#clearAvatarBtn").onclick = () => { tempAvatarB64 = ""; drawAvatarPreview(); };
  $("#avatarFileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) readImageAsB64(f, 256, (b64) => { tempAvatarB64 = b64; drawAvatarPreview(); });
    e.target.value = "";
  });
  $("#agentAvatar").addEventListener("input", drawAvatarPreview);
  $("#agentTemp").addEventListener("input", (e) => { $("#agentTempVal").textContent = "：" + e.target.value; });

  // 设置弹窗
  $("#settingsSaveBtn").onclick = saveSettings;
  $("#settingsCancelBtn").onclick = closeSettings;
  $("#settingsTestBtn").onclick = testConnection;
  $("#uploadWallpaperBtn").onclick = () => $("#wallpaperFileInput").click();
  $("#uploadUserAvatarBtn").onclick = () => $("#userAvatarFileInput").click();
  $("#clearUserAvatarBtn").onclick = () => { tempUserAvatarB64 = ""; drawUserAvatarPreview(); };
  $("#userAvatarFileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) readImageAsB64(f, 256, (b64) => { tempUserAvatarB64 = b64; drawUserAvatarPreview(); });
    e.target.value = "";
  });
  $("#clearWallpaperBtn").onclick = () => {
    state.settings.wallpaper = ""; state.settings.wallpaperUrl = "";
    saveState(); applyWallpaper(); toast("已恢复默认背景");
  };
  $("#wallpaperFileInput").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const j = await uploadMedia("wallpaper", f);      // 原图直传服务端
      state.settings.wallpaperUrl = j.url;
      state.settings.wallpaper = "";                    // 不再往 localStorage 塞大图
      if (!saveState()) toast("原图已保存，但浏览器本地存储仍偏满");
      applyWallpaper();
      toast("背景已更新（原图 " + (j.bytes / 1048576).toFixed(1) + "MB，未压缩）");
    } catch (err) {
      // 没有本地服务时的退路：压成 JPEG 再存浏览器，尽量不爆配额
      readImageAsB64(f, 2560, (b64) => {
        state.settings.wallpaper = b64;
        state.settings.wallpaperUrl = "";
        if (saveState()) { applyWallpaper(); toast("背景已更新（浏览器存储模式，已压缩）"); }
      }, "image/jpeg", 0.92);
    }
  });
  // 背景透明度：实时预览（数值越大越透明）
  $("#wallpaperOpacity").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10) || 0;
    $("#wallpaperOpacityVal").textContent = v + "%";
    const w = $("#wallpaper");
    if (v >= 100) { w.style.backgroundImage = ""; w.style.opacity = 1; }
    else { w.style.opacity = 1 - v / 100; }
  });

  // 批量删除
  $("#batchBtn").onclick = toggleBatch;
  $("#delSelectedBtn").onclick = deleteSelected;
  $("#cancelBatchBtn").onclick = toggleBatch;

  // 朋友圈
  $("#momentsBtn").onclick = openMoments;
  $("#momentsBackBtn").onclick = closeMoments;
  $("#postBtn").onclick = openPostModal;
  $("#autoPostBtn").onclick = autoMoments;
  $("#postAutoGenBtn").onclick = postAutoGen;
  $("#postSaveBtn").onclick = publishPost;
  $("#postCancelBtn").onclick = () => hideModal("postModal");
  $("#commentAutoBtn").onclick = aiInteract;
  $("#commentUserBtn").onclick = userComment;
  $("#commentCancelBtn").onclick = () => hideModal("commentModal");

  // 数据
  $("#exportBtn").onclick = exportData;
  $("#importBtn").onclick = () => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json"; inp.onchange = (e) => { if (e.target.files[0]) importData(e.target.files[0]); }; inp.click(); };

  // 弹窗点击遮罩关闭
  ["agentModal", "settingsModal", "postModal", "commentModal"].forEach(id => {
    $("#" + id).addEventListener("click", (e) => { if (e.target === $("#" + id)) hideModal(id); });
  });
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false; t.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.hidden = true, 400); }, 3200);
}

/* ---------------- 启动 ---------------- */
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

/* 本地服务在跑的话，第一次打开自动把「寄」和他的设置灌进来（不用手动导入）。
   API Key 留在这台电脑的服务端，浏览器里不存。 */
async function bootstrapFromServer() {
  if (agents().length) return;                       // 已经有数据就不动
  try {
    // 口令（?k=...）由你打开的链接带进来，服务端校验后才给数据
    const r = await fetch("/api/bootstrap" + (location.search || ""), { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    if (!data || !data.agents || !data.agents.length) return;
    state.settings = Object.assign(state.settings, data.settings || {});
    state.agents = data.agents;
    saveState();
    renderAgentList();
    if (state.agents[0]) {
      currentId = state.agents[0].id;
      renderAgentList();
      renderChat();
    }
    toast("已从本地服务载入「" + state.agents[0].name + "」");
  } catch (e) { /* 没有本地服务就照常 */ }
}


/* ================= 手机端底部 tab 切换 =================
   消息 / 联系人 / 朋友圈 / 我 / 反馈。
   尽量复用现有界面：联系人 = 打开现有的侧边栏抽屉，朋友圈 = 现有的 #momentsView，
   我 / 反馈 = 新增的全屏覆盖页。 */
function showTab(tab) {
  const sidebar = $("#sidebar");
  const moments = $("#momentsView");
  const profile = $("#profilePage");
  const feedback = $("#feedbackPage");
  if (!tab) tab = "chat";

  // 先把不该露的都收起来
  if (tab !== "contacts" && sidebar) sidebar.classList.remove("open");
  if (moments) moments.hidden = (tab !== "moments");
  if (profile) profile.hidden = (tab !== "me");
  if (feedback) feedback.hidden = (tab !== "feedback");

  if (tab === "contacts" && sidebar) sidebar.classList.add("open");
  if (tab === "moments" && typeof openMoments === "function") {
    try { openMoments(); } catch (e) {}
  }
  if (tab === "me" && typeof drawMe === "function") drawMe();

  document.querySelectorAll("#tabbar .tab-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.body.classList.add("tabbed");
  if (tab === "chat") scrollBottom();
}

/* 「我」这页显示用户名和头像（跟设置里的保持一致） */
function drawMe() {
  try {
    const n = $("#meName"), av = $("#meAvatar"), sub = $("#meSub");
    if (!n) return;
    const nm = (state.settings.user_name || "").trim() || "我";
    n.textContent = nm;
    av.innerHTML = state.settings.avatar ? `<img src="${esc(state.settings.avatar)}" alt="">`
                                         : esc(nm.slice(0, 1));
    if (sub) sub.textContent = "点「设置」可以改名字、头像、壁纸";
  } catch (e) {}
}

function initTabs() {
  const bar = $("#tabbar");
  if (!bar) return;
  bar.querySelectorAll(".tab-item").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });
  document.body.classList.add("tabbed");
  showTab("chat");
}


/* ================= 主题颜色（自定义 + 渐变） =================
   直接改 CSS 变量，所以整个界面（气泡、按钮、tab、背景）都会跟着变。 */
const THEME_DEFAULT = { c1: "#8F6FB6", c2: "#C7B3E0" };

function applyTheme(c1, c2, gradient) {
  c1 = c1 || THEME_DEFAULT.c1;
  c2 = c2 || THEME_DEFAULT.c2;
  let st = document.getElementById("themeStyle");
  if (!st) {
    st = document.createElement("style");
    st.id = "themeStyle";
    document.head.appendChild(st);
  }
  // 由主色推一个深一点的颜色（按亮度压 12%），保证按钮文字对比度够
  function darken(hex, f) {
    try {
      const n = parseInt(hex.slice(1), 16);
      const r = Math.max(0, Math.round(((n >> 16) & 255) * f));
      const g = Math.max(0, Math.round(((n >> 8) & 255) * f));
      const b = Math.max(0, Math.round((n & 255) * f));
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    } catch (e) { return hex; }
  }
  const bg = gradient ? `linear-gradient(135deg, ${c1}, ${c2})` : c1;
  st.textContent = `
    :root {
      --brand: ${c1};
      --brand-dark: ${darken(c1, 0.86)};
      --brand-light: ${c2};
      --user-bubble: ${gradient ? bg : c1};
      --splash-top: ${c1};
    }
    .primary-btn, #sendBtn, .row-btn.primary { background: ${bg} !important; color: #fff !important; }
    .tab-item.active { color: ${c1} !important; }
    .chat-header { background: ${bg} !important; }
    .msg.user .bubble { background: ${bg} !important; }
    .theme-preview { background: ${bg} !important; }
  `;
}

function initTheme() {
  const s1 = $("#themeColor1"), s2 = $("#themeColor2"), g = $("#themeGradient");
  if (!s1) return;
  const t = state.settings.theme || {};
  const c1 = t.c1 || THEME_DEFAULT.c1;
  const c2 = t.c2 || THEME_DEFAULT.c2;
  const grad = !!t.gradient;
  s1.value = c1; s2.value = c2; g.checked = grad;
  applyTheme(c1, c2, grad);

  function save() {
    state.settings.theme = { c1: s1.value, c2: s2.value, gradient: g.checked };
    saveState();
    applyTheme(s1.value, s2.value, g.checked);
  }
  s1.addEventListener("input", save);
  s2.addEventListener("input", save);
  g.addEventListener("change", save);
}

function resetTheme() {
  const s1 = $("#themeColor1"), s2 = $("#themeColor2"), g = $("#themeGradient");
  if (!s1) return;
  s1.value = THEME_DEFAULT.c1; s2.value = THEME_DEFAULT.c2; g.checked = false;
  state.settings.theme = null;
  saveState();
  applyTheme(THEME_DEFAULT.c1, THEME_DEFAULT.c2, false);
  toast("颜色已还原");
}

/* ================= 上传聊天记录 → 自动抽语气样本 =================
   目标：想复刻一个 AI 的人，不用一条条手抄样本。
   支持 .json / .jsonl（有 role+content 的）以及纯文本 .txt。 */
function initUpload() {
  const inp = $("#styleUpload");
  if (!inp) return;
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const tip = $("#styleUploadTip");
    const reader = new FileReader();
    reader.onload = () => {
      let pairs = [];
      try { pairs = extractPairs(String(reader.result || "")); } catch (e) { pairs = []; }
      if (!pairs.length) {
        tip.textContent = "没从这个文件里认出「一问一答」。支持导出过的聊天记录（.json / .jsonl），或者一行一句的 .txt。";
        return;
      }
      const block = buildStyleBlock(pairs);
      const ta = $("#agentPersona");
      if (ta) {
        ta.value = (ta.value ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + block;
      }
      tip.textContent = `认出了 ${pairs.length} 组对话，已经写进下面的人设里了（想删就手删那一段）。`;
      if (typeof toast === "function") toast("样本已写入人设");
    };
    reader.readAsText(f);
  });
}

function extractPairs(text) {
  const out = [];
  const push = (role, content) => {
    role = String(role || "").toLowerCase();
    content = String(content || "").trim();
    if (!content || content.length > 1200) return;
    if (role !== "user" && role !== "assistant") return;
    out.push({ role, content });
  };
  const t = text.trim();
  // ① JSONL：每行一个对象
  if (/^\s*\{/.test(t) && t.includes("\n")) {
    t.split(/\r?\n/).forEach((line) => {
      line = line.trim();
      if (!line.startsWith("{")) return;
      try {
        const o = JSON.parse(line);
        push(o.role, o.content || o.text || o.message);
      } catch (e) {}
    });
  }
  // ② 整个 JSON（数组或 {messages:[...]} / {data:{...}}）
  if (!out.length && /^\s*[\[{]/.test(t)) {
    try {
      let o = JSON.parse(t);
      if (o && !Array.isArray(o)) o = o.messages || (o.data && o.data.messages) || o.conversation || [];
      if (Array.isArray(o)) o.forEach((m) => m && push(m.role, m.content || m.text));
    } catch (e) {}
  }
  // ③ 纯文本：按「你：」「我：」「User:」「AI:」之类辨认
  if (!out.length) {
    t.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*(我|用户|user|me|你|ta|他|她|ai|AI|assistant|机器人)\s*[：:>]\s*(.+)$/);
      if (!m) return;
      const who = /^(我|用户|user|me|你)$/i.test(m[1]) ? "user" : "assistant";
      push(who, m[2]);
    });
  }
  // 配成 (user, assistant) 对，最多 12 组
  const pairs = [];
  for (let i = 0; i < out.length - 1 && pairs.length < 12; i++) {
    if (out[i].role === "user" && out[i + 1].role === "assistant") {
      pairs.push([out[i].content, out[i + 1].content]);
      i++;
    }
  }
  if (!pairs.length && out.length) {                       // 没配成对，就按单句给
    const half = Math.min(6, Math.floor(out.length / 2));
    for (let i = 0; i < half; i++) {
      pairs.push([out[i * 2].content, out[i * 2 + 1] ? out[i * 2 + 1].content : ""]);
    }
  }
  return pairs;
}

function buildStyleBlock(pairs) {
  const lines = pairs
    .filter((p) => p[1])
    .map((p) => `用户：${p[0].slice(0, 200)}\n它：${p[1].slice(0, 400)}`)
    .join("\n\n");
  return "【语气样本（照这个节奏和语气说话，不要复述、不要提这段样本）】\n" + lines;
}


/* ================= 上传收款码（手机选图 → 存到电脑） ================= */
function initRewardUpload() {
  const inp = $("#rewardUpload");
  if (!inp) return;
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const tip = $("#rewardUpTip");
    if (tip) tip.textContent = "正在上传…";
    try {
      const q = tokenQuery();
      const r = await fetch("/api/reward" + (q ? "?" + q : ""), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: f,
      });
      const jd = await r.json().catch(() => ({}));
      if (r.ok && jd.ok) {
        if (tip) tip.textContent = "存好了 ✓ 两边都会显示（电脑上要重开一次 Lovera）";
        const img = $("#rewardImg");
        if (img) {
          img.style.display = "";
          img.src = "reward.png?t=" + Date.now();
          const rt = $("#rewardTip");
          if (rt) rt.style.display = "none";
        }
        toast("收款码已上传");
      } else {
        if (tip) tip.textContent = "没存上：" + (jd.error || ("HTTP " + r.status));
      }
    } catch (e) {
      if (tip) tip.textContent = "上传失败（连不上电脑？）";
    }
  });
}

/* ================= 新手引导卡（第一次用的人才看到） =================
   为什么要有它：大多数人卡在"API Key 往哪填"，而说明文档他们不会看。
   所以直接把三步写在界面上，并给一个直达申请页的链接。 */
function maybeShowGuide() {
  try {
    if (localStorage.getItem("lovera_guide_done") === "1") return;
    const box = $("#messages");
    if (!box) return;
    const agents = (state && state.agents) || [];
    const anyTalk = agents.some((a) => (a.messages || []).length > 0);
    if (anyTalk) return;                       // 已经聊过了，不打扰
    if ($("#firstGuide")) return;

    const el = document.createElement("div");
    el.id = "firstGuide";
    el.className = "first-guide";
    el.innerHTML =
      '<div class="fg-title">先做这一步，就能开始聊了</div>' +
      '<div class="fg-sub">Lovera 自己不会说话，它要用你自己的 AI 账号（一串 sk- 开头的钥匙）。</div>' +
      '<ol class="fg-steps">' +
        '<li>打开 <a href="https://platform.deepseek.com" target="_blank" rel="noopener">platform.deepseek.com</a>，注册登录</li>' +
        '<li>左边菜单找 <b>API keys</b> → 创建 → <b>复制那串 sk-</b>（只显示一次，先复制）</li>' +
        '<li>充 10 元（不充会提示余额不足），然后回到这里：<b>⚙ 设置 → API Key</b> → 粘进去</li>' +
      '</ol>' +
      '<div class="fg-warn">⚠️ 「默认模型名」那栏别动，也别把 key 填到那一栏（会报"请求参数有误"）。</div>' +
      '<div class="fg-btns">' +
        '<button class="fg-ok" type="button">我知道了，不再提示</button>' +
      '</div>';
    box.insertBefore(el, box.firstChild);
    el.querySelector(".fg-ok").addEventListener("click", () => {
      try { localStorage.setItem("lovera_guide_done", "1"); } catch (e) {}
      el.remove();
    });
  } catch (e) { /* 出问题就不显示，不影响使用 */ }
}


/* ================= 手机端：编辑/清空 收进三条杠菜单 =================
   为什么不直接改 HTML：我不知道那两个按钮的 id/class，猜错就白改。
   所以按"文字"找它们，藏起来，再用菜单项代替点击 —— 功能一个都没少。 */
function compactHeader() {
  try {
    if (window.innerWidth > 720) return;                 // 电脑上不动它
    const bar = document.querySelector(".chat-header");
    if (!bar || document.getElementById("hdrMenuBtn")) return;
    const wanted = ["编辑", "清空"];
    const found = {};
    const nodes = bar.querySelectorAll("button, a, span, div");
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (wanted.indexOf(t) >= 0 && !found[t] && el.children.length === 0) {
        found[t] = el;
      }
    }
    if (!Object.keys(found).length) return;
    Object.keys(found).forEach(function (k) { found[k].style.display = "none"; });

    const btn = document.createElement("button");
    btn.id = "hdrMenuBtn";
    btn.type = "button";
    btn.className = "hdr-burger";
    btn.setAttribute("aria-label", "更多");
    btn.textContent = "\u2630";                          // ☰

    const menu = document.createElement("div");
    menu.id = "hdrMenu";
    menu.className = "hdr-menu-pop";
    menu.style.display = "none";

    Object.keys(found).forEach(function (name) {
      const it = document.createElement("button");
      it.type = "button";
      it.textContent = name;
      it.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.style.display = "none";
        try { found[name].click(); } catch (err) {}
      });
      menu.appendChild(it);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.style.display = (menu.style.display === "none") ? "block" : "none";
    });
    document.addEventListener("click", function () { menu.style.display = "none"; });

    bar.appendChild(btn);
    bar.appendChild(menu);
  } catch (e) { /* 出问题就当没这功能，绝不影响别的 */ }
}


/* ================= 手机端：发送框瘦身 =================
   只留「发送」，其他按钮收进「＋」；藏掉那行提示；并把空间还给消息区。
   全部按文字找按钮，不依赖 class —— 找不到就什么都不做。 */
function compactComposer() {
  try {
    if (window.innerWidth > 720) return;
    if (document.getElementById("cmpPlus")) return;

    const btns = Array.prototype.slice.call(document.querySelectorAll("button"));
    const send = btns.filter(function (b) {
      return (b.textContent || "").trim() === "发送";
    })[0];
    if (!send || !send.parentElement) return;
    const row = send.parentElement;

    const others = Array.prototype.slice.call(row.querySelectorAll("button"))
      .filter(function (b) { return b !== send; });
    if (others.length) {
      others.forEach(function (b) { b.style.display = "none"; });

      const plus = document.createElement("button");
      plus.id = "cmpPlus";
      plus.type = "button";
      plus.className = "cmp-plus";
      plus.setAttribute("aria-label", "更多");
      plus.textContent = "\uFF0B";                    // ＋

      const menu = document.createElement("div");
      menu.id = "cmpMenu";
      menu.className = "cmp-menu";
      menu.style.display = "none";

      const fallback = ["发图片", "朗读", "打电话", "更多"];
      others.forEach(function (b, i) {
        const label = ((b.title || b.getAttribute("aria-label") ||
                        b.textContent || "").trim()) || fallback[i] || ("功能" + (i + 1));
        const it = document.createElement("button");
        it.type = "button";
        it.textContent = label;
        it.addEventListener("click", function (e) {
          e.stopPropagation();
          menu.style.display = "none";
          try { b.click(); } catch (err) {}
        });
        menu.appendChild(it);
      });

      plus.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.style.display = (menu.style.display === "none") ? "block" : "none";
      });
      document.addEventListener("click", function () { menu.style.display = "none"; });

      row.appendChild(plus);
      row.appendChild(menu);
    }

    // 藏掉「Enter 发送 · Shift+Enter 换行 ...」那行提示（手机上没用，还占地方）
    Array.prototype.slice.call(document.querySelectorAll("div, span, p")).forEach(function (el) {
      const t = (el.textContent || "").trim();
      if (t.indexOf("Enter 发送") === 0 && el.children.length === 0) {
        el.style.display = "none";
      }
    });

    // 把空间还给消息区（flex 子元素不加 min-height:0 会被内容顶开，导致看不到消息）
    const msgs = document.getElementById("messages");
    if (msgs) {
      msgs.style.minHeight = "0";
      msgs.style.flex = "1 1 auto";
      msgs.style.overflowY = "auto";
      msgs.style.webkitOverflowScrolling = "touch";
    }
  } catch (e) { /* 出问题就当没这功能 */ }
}

function boot() {
  initSplash();
  bindEvents();
  initSpeak();          // 朗读开关（用手机自带语音，不依赖电脑）
  initTabs();           // 手机端底部 tab + 反馈
  maybeShowGuide();     // 新手引导（第一次用才显示）
  compactHeader();      // 手机上把编辑/清空收进三条杠
  compactComposer();    // 手机上把发送框瘦身
  initTheme();          // 主题颜色（自定义 + 渐变）
  initUpload();         // 创建 AI 时上传聊天记录，自动抽语气样本
  initRewardUpload();   // 反馈页上传收款码
  applyWallpaper();
  renderAgentList();
  renderChat();
  bootstrapFromServer();
  offloadBigWallpaper();
  // 与电脑端同步：打开时拉一次，之后每 8 秒看一眼有没有新消息
  setTimeout(() => syncHistory(getAgent(currentId)), 800);
  setInterval(() => { if (!generating) { flushPending(); syncHistory(getAgent(currentId)); } }, 8000);
  if ("serviceWorker" in navigator) {
    if (isLocal) {
      // 本地(localhost)不缓存：注销旧 Service Worker，保证每次刷新都读最新文件，避免“旧代码”问题
      navigator.serviceWorker.getRegistrations().then((rs) => {
        rs.forEach((r) => r.unregister());
      }).catch(() => {});
    } else {
      // 线上（HTTPS）才注册，用于 PWA 安装/离线
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }
}
document.addEventListener("DOMContentLoaded", boot);
