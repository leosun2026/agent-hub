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
          '<button title="导出" onclick="event.stopPropagation();alert(\'原型：导出 ' + month + ' 聊天记录\')">↗</button>' +
          '<button class="danger" title="删除" onclick="event.stopPropagation();alert(\'原型：删除 ' + month + ' 记录\')">✕</button>' +
          "</div>";
        histList.appendChild(day);
      });
    })
    .catch(function(e) { console.error("Failed to load history sidebar:", e); });
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
  var content = "";
  var msgs = chatMessages.querySelectorAll(".chat-msg:not(.system)");
  msgs.forEach(function(m) {
    var text = m.querySelector(".msg-text");
    if (text) content += text.textContent + "\n---\n";
  });
  alert("原型：导出聊天记录\n\n" + (content.length > 200 ? "（共 " + content.length + " 字符，将导出到默认目录）" : "（无内容可导出）"));
}

// ============ Add Member ============

function openAddMember() {
  addMemberStep = 1;
  document.getElementById("step1").style.display = "block";
  document.getElementById("step2").style.display = "none";
  document.getElementById("btnNext").style.display = "inline-block";
  document.getElementById("btnPrev").style.display = "none";
  document.getElementById("btnConfirm").style.display = "none";
  document.getElementById("btnCancel").textContent = "取消";
  pasteValid = false;
  pasteData = null;
  document.getElementById("pasteError").style.display = "none";
  document.getElementById("previewPanel").innerHTML = "";
  document.getElementById("addMemberOverlay").classList.add("show");
}

function closeAddMember() {
  document.getElementById("addMemberOverlay").classList.remove("show");
}

function nextStep() {
  if (addMemberStep === 1) {
    document.getElementById("step1").style.display = "none";
    document.getElementById("step2").style.display = "block";
    document.getElementById("btnNext").style.display = "none";
    document.getElementById("btnPrev").style.display = "inline-block";
    document.getElementById("btnConfirm").style.display = pasteValid ? "inline-block" : "none";
    addMemberStep = 2;
  }
}

function prevStep() {
  if (addMemberStep === 2) {
    document.getElementById("step1").style.display = "block";
    document.getElementById("step2").style.display = "none";
    document.getElementById("btnNext").style.display = "inline-block";
    document.getElementById("btnPrev").style.display = "none";
    document.getElementById("btnConfirm").style.display = "none";
    addMemberStep = 1;
  }
}

function copyInvite() {
  var text = document.getElementById("inviteText").textContent;
  navigator.clipboard.writeText(text).then(function() {
    alert("邀请已复制到剪贴板");
  }).catch(function() {
    alert("复制失败，请手动复制");
  });
}

function previewPaste() {
  var raw = document.getElementById("pasteArea").value.trim();
  var error = document.getElementById("pasteError");
  var preview = document.getElementById("previewPanel");

  if (!raw) {
    error.style.display = "none";
    preview.innerHTML = "";
    pasteValid = false;
    document.getElementById("btnConfirm").style.display = "none";
    return;
  }

  try {
    var data = JSON.parse(raw);
    if (!data.id || !data.name || !data.role) {
      error.textContent = "缺少必填字段 id, name, role";
      error.style.display = "block";
      preview.innerHTML = "";
      pasteValid = false;
      document.getElementById("btnConfirm").style.display = "none";
      return;
    }
    error.style.display = "none";
    pasteData = data;
    pasteValid = true;
    document.getElementById("btnConfirm").style.display = "inline-block";
    preview.innerHTML =
      '<div class="preview-valid">\u2705 配置有效</div>' +
      "<div>ID: " + esc(data.id) + "</div>" +
      "<div>Name: " + esc(data.name) + "</div>" +
      "<div>Role: " + esc(data.role) + "</div>" +
      "<div>Endpoint: " + esc(data.endpoint || "(none)") + "</div>";
  } catch (e) {
    error.textContent = "JSON 解析错误: " + e.message;
    error.style.display = "block";
    preview.innerHTML = "";
    pasteValid = false;
    document.getElementById("btnConfirm").style.display = "none";
  }
}

function confirmAddMember() {
  if (!pasteValid || !pasteData) return;
  var btn = document.getElementById("btnConfirm");
  btn.disabled = true;
  btn.textContent = "添加中...";
  fetch("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pasteData),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(err) { throw new Error(err.error); });
      return r.json();
    })
    .then(function() {
      closeAddMember();
      return fetch("/api/agents");
    })
    .then(function(r) { return r.json(); })
    .then(function(d) { agents = d; renderAgentSidebar(); })
    .catch(function(err) {
      alert("Error: " + err.message);
      btn.disabled = false;
      btn.textContent = "确认添加";
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
  return saved || "👤";
}
function getBossName() {
  var saved = localStorage.getItem("hub_boss_name");
  return saved || "力哥";
}
function getBossBio() {
  var saved = localStorage.getItem("hub_boss_bio");
  return saved || "AI 时代的手艺人";
}
