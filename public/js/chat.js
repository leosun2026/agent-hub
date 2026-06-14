// Chat logic — Agent Hub v2.1 UI (room-less frontend)
var chatMessages = document.getElementById("chatMessages");
var chatInput = document.getElementById("chatInput");
var addMemberStep = 1;
var pasteValid = false;
var pasteData = null;

// ============ Initialization ============

(function init() {
  fetch("/api/agents")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      agents = data;
      renderAgentSidebar();
    })
    .catch(function(e) { console.error("Failed to load agents:", e); });

  loadHistory();
})();

function loadHistory() {
  fetch("/api/messages?room_id=room-general")
    .then(function(r) { return r.json(); })
    .then(function(msgs) {
      chatMessages.innerHTML = "";
      appendSystemMessage("💡 输入 / 查看全部命令");
      msgs.forEach(function(msg) { appendMessage(msg); });
    })
    .catch(function(e) { console.error("Failed to load history:", e); });
}

// ============ Socket Events ============

socket.on("chat:message", function(msg) {
  appendMessage(msg);
});

socket.on("chat:system", function(data) {
  if (data.type === "member:joined") {
    appendSystemMessage(data.payload.agentName + " 加入了聊天");
  } else if (data.type === "member:removed") {
    appendSystemMessage(data.payload.agentName + " 已移出聊天");
  }
});

socket.on("agent:state", function(data) {
  var dot = document.getElementById("dot-" + data.agentId);
  if (dot) {
    dot.className = "status-dot " + (data.state === "thinking" ? "thinking" : (dot.dataset.online === "true" ? "online" : "offline"));
  }
});

socket.on("member:added", refreshAgents);
socket.on("member:removed", refreshAgents);
socket.on("member:updated", refreshAgents);
socket.on("agents:list", function(data) { agents = data; renderAgentSidebar(); });

function refreshAgents() {
  fetch("/api/agents").then(function(r) { return r.json(); }).then(function(d) { agents = d; renderAgentSidebar(); });
}

// ============ Send Message ============

chatInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === "Escape") { hideMentionDropdown(); }
});

chatInput.addEventListener("input", function() {
  var val = chatInput.value, cursorPos = chatInput.selectionStart;
  var textBefore = val.substring(0, cursorPos), atIdx = textBefore.lastIndexOf("@");
  if (atIdx >= 0 && textBefore.substring(atIdx + 1).indexOf(" ") < 0) {
    showMentionDropdown(textBefore.substring(atIdx + 1));
    return;
  }
  hideMentionDropdown();
});

document.addEventListener("click", function(e) {
  if (!e.target.closest(".mention-dropdown") && !e.target.closest("#chatInput")) {
    hideMentionDropdown();
  }
});

function sendMessage() {
  var content = chatInput.value.trim();
  if (!content) return;
  socket.emit("chat:send", { room_id: "room-general", agent_id: "user", role: "user", content: content });
  chatInput.value = "";
  hideMentionDropdown();
}

// ============ Render Messages ============

function appendMessage(msg) {
  var div = document.createElement("div");
  if (msg.role === "system") {
    div.className = "chat-msg system";
    div.innerHTML = "<div class=\"msg-text\">" + esc(msg.content) + "</div>";
  } else if (msg.role === "user") {
    div.className = "chat-msg user";
    div.innerHTML =
      "<span class=\"msg-avatar\">" + getBossAvatar() + "</span>" +
      '<div class="msg-body">' +
      '<div class="msg-header">' + getBossName() + " \u00b7 " + formatTime(msg.created_at) + "</div>" +
      '<div class="msg-text">' + esc(msg.content) + "</div>" +
      "</div>";
  } else {
    div.className = "chat-msg";
    var agent = agents.find(function(a) { return a.id === msg.agent_id; });
    var avatar = agent ? agent.avatar : "\u{1F916}";
    var name = agent ? (agent.nickname || agent.name) : (msg.agent_id || "Agent");
    div.innerHTML =
      "<span class=\"msg-avatar\">" + avatar + "</span>" +
      '<div class="msg-body">' +
      '<div class="msg-header">' + name + " \u00b7 " + formatTime(msg.created_at) + "</div>" +
      '<div class="msg-text">' + esc(msg.content) + "</div>" +
      "</div>";
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
  var div = document.createElement("div");
  div.className = "chat-msg system";
  div.innerHTML = "<div class=\"msg-text\">" + esc(text) + "</div>";
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============ Agent Sidebar (replaces room selector) ============

function renderAgentSidebar() {
  var sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  sidebar.innerHTML = "";

  // Agent list title (matches prototype)
  var listTitle = document.createElement("div");
  listTitle.className = "sidebar-section-title";
  listTitle.textContent = "Agent 列表";
  sidebar.appendChild(listTitle);

  agents.forEach(function(a) {
    var card = document.createElement("div");
    card.className = "agent-card";
    card.setAttribute("data-id", a.id);

    var onlineClass = "offline";
    if (!a.endpoint) onlineClass = "offline";

    var displayName = a.nickname || a.name;
    var idLabel = a.id;

    card.innerHTML =
      "<div class=\"agent-card-left\">" +
      '<span class="agent-avatar">' + a.avatar + "</span>" +
      '<div class="agent-info">' +
      '<div class="name" ondblclick="startEditNickname(\'' + a.id + "','" + escAttr(displayName) + "')\">" + esc(displayName) + "</div>" +
      '<div class="agent-id">' + esc(idLabel) + "</div>" +
      "</div></div>" +
      '<button class="agent-edit-btn" onclick="event.stopPropagation();startEditNickname(\'' + a.id + "','" + escAttr(displayName) + "')\" title=\"编辑昵称\">✏️</button>" +
      '<span class="status-dot ' + onlineClass + '" id="dot-' + a.id + '" data-online="' + (onlineClass === "online") + '"></span>';

    // Click agent card to insert @mention in input
    card.onclick = function() {
      chatInput.focus();
      insertMention(a.id);
    };

    sidebar.appendChild(card);
  });

  // Chat history section
  var title = document.createElement("div");
  title.className = "sidebar-section-title";
  title.textContent = "聊天记录";
  sidebar.appendChild(title);

  var histList = document.createElement("div");
  histList.className = "history-list";
  histList.id = "historyList";
  sidebar.appendChild(histList);
  loadHistorySidebar();

  // Settings button (floats at bottom of sidebar)
  var settingsBtn = document.createElement("button");
  settingsBtn.className = "btn-settings-float";
  settingsBtn.onclick = openSettings;
  settingsBtn.title = "设置";
  settingsBtn.textContent = "⚙️";
  sidebar.appendChild(settingsBtn);
}

function loadHistorySidebar() {
  fetch("/api/messages?room_id=room-general")
    .then(function(r) { return r.json(); })
    .then(function(msgs) {
      var histList = document.getElementById("historyList");
      if (!histList) return;
      histList.innerHTML = "";

      // Group messages by date
      var groups = {};
      msgs.forEach(function(msg) {
        if (!msg.created_at) return;
        var d = new Date(msg.created_at);
        var key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
        if (!groups[key]) groups[key] = { date: d, count: 0 };
        groups[key].count++;
      });

      // Sort dates descending
      var keys = Object.keys(groups).sort().reverse();
      keys.forEach(function(key) {
        var g = groups[key];
        var day = document.createElement("div");
        day.className = "history-day";
        var month = (g.date.getMonth() + 1) + "月" + g.date.getDate() + "日";
        day.innerHTML =
          "<span>" + month + "</span>" +
          '<span class="day-count">' + g.count + '条</span>' +
          '<div class="day-actions">' +
          '<button title="导出" onclick="event.stopPropagation();exportMonthChat(month)">↗</button>' +
          '<button class="danger" title="删除" onclick="event.stopPropagation();deleteMonthChat(month)">✕</button>' +
          "</div>";
        histList.appendChild(day);
      });
    })
    .catch(function(e) { console.error("Failed to load history sidebar:", e); });
}



// ============ History Export / Delete ============

function exportMonthChat(monthLabel) {
  var msgs = chatMessages.querySelectorAll(".chat-msg:not(.system)");
  var monthMsgs = [];
  msgs.forEach(function(msg) {
    var header = msg.querySelector(".msg-header");
    if (header && header.textContent.indexOf(monthLabel) !== -1) {
      monthMsgs.push(msg);
    }
  });
  if (monthMsgs.length === 0) {
    alert("该月没有消息");
    return;
  }
  var text = "Agent Hub 聊天记录 - " + monthLabel + "\n";
  text += "=".repeat(50) + "\n\n";
  monthMsgs.forEach(function(msg) {
    var sender = msg.querySelector(".msg-header");
    var content = msg.querySelector(".msg-text");
    if (sender) text += sender.textContent.trim() + "\n";
    if (content) text += content.textContent.trim() + "\n";
    text += "\n";
  });
  var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "chat-" + monthLabel + ".txt";
  a.click();
  URL.revokeObjectURL(a.href);
}

function deleteMonthChat(month) {
  if (!confirm("确定要删除 " + month + " 的聊天记录吗？此操作不可撤销。")) return;
  var msgs = chatMessages.querySelectorAll(".chat-msg");
  var count = 0;
  msgs.forEach(function(msg) {
    var header = msg.querySelector(".msg-header");
    if (header && header.textContent.indexOf(month) !== -1) {
      msg.remove();
      count++;
    }
  });
  if (count > 0) {
    // Reload history
    loadChatHistory();
  }
}


// ============ Mention Dropdown ============

function showMentionDropdown(query) {
  var existing = document.getElementById("mentionDropdown");
  if (existing) existing.remove();

  var matching = agents.filter(function(a) {
    return (a.id.toLowerCase().indexOf(query.toLowerCase()) >= 0 ||
      (a.name && a.name.toLowerCase().indexOf(query.toLowerCase()) >= 0));
  });

  if (matching.length === 0) return;

  var dd = document.createElement("div");
  dd.id = "mentionDropdown";
  dd.className = "mention-dropdown";

  matching.forEach(function(a) {
    var item = document.createElement("div");
    item.className = "mention-item";
    item.innerHTML =
      "<span class=\"mention-avatar\">" + a.avatar + "</span>" +
      '<span class="mention-name">' + esc(a.nickname || a.name) + "</span>";
    item.addEventListener("click", function() { insertMention(a.id); });
    dd.appendChild(item);
  });

  var inputRect = chatInput.getBoundingClientRect();
  dd.style.position = "fixed";
  // Position ABOVE the input (input is at bottom of screen)
  var ddHeight = Math.min(matching.length * 42 + 8, 200);
  dd.style.bottom = (window.innerHeight - inputRect.top + 6) + "px";
  dd.style.left = inputRect.left + "px";
  dd.style.width = "220px";
  document.body.appendChild(dd);
}

function hideMentionDropdown() {
  var dd = document.getElementById("mentionDropdown");
  if (dd) dd.remove();
}

function insertMention(agentId) {
  var val = chatInput.value;
  var cursorPos = chatInput.selectionStart;
  var textBefore = val.substring(0, cursorPos);
  var atIdx = textBefore.lastIndexOf("@");
  var wordBefore = textBefore.substring(atIdx + 1);
  // Use agent nickname instead of raw agentId
  var agent = agents.find(function(a) { return a.id === agentId; });
  var mentionName = agent ? (agent.nickname || agent.name) : agentId;
  chatInput.value = val.substring(0, atIdx) + "@" + mentionName + " " + val.substring(cursorPos);
  chatInput.focus();
  var newPos = atIdx + mentionName.length + 2;
  chatInput.setSelectionRange(newPos, newPos);
  hideMentionDropdown();
}

// ============ Export ============

function exportChat() {
  var prefix = document.getElementById("settingsExportPath");
  var savePath = prefix ? prefix.value : "D:\\Agent Hub\\exports\\";
  var content = "";
  var msgs = chatMessages.querySelectorAll(".chat-msg:not(.system)");
  msgs.forEach(function(m) {
    var header = m.querySelector(".msg-header");
    var text = m.querySelector(".msg-text");
    if (header) content += header.textContent.trim() + "\n";
    if (text) content += text.textContent.trim() + "\n";
    content += "---\n";
  });
  if (!content) { alert("（无内容可导出）"); return; }
  var now = new Date();
  var dateStr = now.getFullYear() + "-" + (now.getMonth()+1) + "-" + now.getDate() + "_" + now.getHours() + "-" + now.getMinutes();
  var filename = "chat-export-" + dateStr + ".txt";
  fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content, filename: filename, exportPath: savePath })
  }).then(function(r){ return r.json(); }).then(function(d){
    if (d.success) { alert("导出成功: " + d.path); }
    else { alert("导出失败: " + (d.error || "未知错误")); }
  }).catch(function(){
    var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.download);
  });
}

// ============ Manage Members ============

function openManageMembers() {
  var panel = document.getElementById("managePanel");
  var body = document.getElementById("managePanelBody");

  var html = "";
  agents.forEach(function(a) {
    var perms = a.group_permissions || {};
    var tags = [];
    if (perms.receive_all !== false) tags.push("接收全部消息");
    if (perms.receive_at_only) tags.push("@提及");
    if (perms.can_send_active !== false) tags.push("可发送");
    if (perms.can_see_history !== false) tags.push("历史可见");

    html += '<div class="manage-agent-card">';
    html += "<span style=\"font-size:24px\">" + a.avatar + "</span>";
    html += '<div class="agent-info"><div class="agent-name">' + esc(a.nickname || a.name) + "</div>";
    html += '<div class="agent-meta">ID: ' + esc(a.id) + " | " + esc(a.role) + " | " + tags.join(" ") + "</div></div>";
    html += '<div class="agent-actions">';
    html += "<button onclick=\"removeAgentPermanent('" + a.id + "')\">移除</button>";
    html += "</div></div>";
  });
  body.innerHTML = html;
  panel.classList.add("show");
}

function closeManageMembers() {
  document.getElementById("managePanel").classList.remove("show");
}

function removeAgentPermanent(id) {
  if (!confirm("确定要移除 Agent " + id + " 吗？")) return;
  fetch("/api/members/" + id, { method: "DELETE" })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(err) { throw new Error(err.error); });
      return r.json();
    })
    .then(function() { return fetch("/api/agents"); })
    .then(function(r) { return r.json(); })
    .then(function(d) { agents = d; renderAgentSidebar(); openManageMembers(); })
    .catch(function(err) { alert("Error: " + err.message); });
}

// ============ Nickname Editing ============

function startEditNickname(agentId, currentName) {
  event.stopPropagation();
  var cards = document.querySelectorAll('.agent-card[data-id="' + agentId + '"]');
  if (cards.length === 0) return;
  var card = cards[cards.length - 1];
  if (!card) return;
  var nameDiv = card.querySelector(".name");
  if (!nameDiv) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "nickname-edit-input";
  input.value = currentName || "";
  input.placeholder = "输入昵称...";

  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); saveNickname(agentId, input.value); }
    if (e.key === "Escape") { e.preventDefault(); renderAgentSidebar(); }
  });
  input.addEventListener("blur", function() { saveNickname(agentId, input.value); });

  nameDiv.innerHTML = "";
  nameDiv.appendChild(input);
  input.focus();
  input.select();
}

function saveNickname(agentId, nickname) {
  var trimmed = (nickname || "").trim().substring(0, 20);
  renderAgentSidebar();
}

// ============ Utilities ============

function esc(str) {
  var div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function escAttr(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTime(isoStr) {
  if (!isoStr) return "";
  try {
    var d = new Date(isoStr);
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return isoStr;
  }
}

function getBossAvatar() {
  var saved = localStorage.getItem("hub_boss_avatar");
  if (saved) return '<img src="' + saved + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover">';
  return "👤";
}
function getBossName() {
  var saved = localStorage.getItem("hub_boss_name");
  return saved || "力哥";
}

/* 打开 Agent 对谈选人弹窗 */
function openPick() {
  var l = document.getElementById("pickAgentList");
  l.innerHTML = "";
  picked = [];
  agents.forEach(function(a){
    if (!a.endpoint) return;
    var r = document.createElement("div");
    r.className = "pick-agent-row";
    r.innerHTML = '<span style="font-size:24px">'+a.avatar+'</span><span class="name">'+(a.nickname||a.name)+'</span><code style="margin-left:auto;font-size:11px;color:var(--text-muted)">@'+a.id+"</code>";
    r.addEventListener("click", function(){ togglePick(r); });
    l.appendChild(r);
  });
  document.getElementById("pickOverlay").classList.add("show");
  document.querySelector(".pick-modal .btn-confirm").textContent = "确认（0/2）";
  document.querySelector(".pick-modal .btn-confirm").style.opacity = "0.5";
}