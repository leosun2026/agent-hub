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
      loadHistory();
    })
    .catch(function(e) { console.error("Failed to load agents:", e); });
})();

function loadHistory(taskId) {
  var url = "/api/messages?room_id=room-general&limit=500";
  if (taskId) url += "&task_id=" + encodeURIComponent(taskId);
  fetch(url)
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
  if (typeof renderPixelOffice === "function") {
    renderPixelOffice();
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
    if (msg.id) div.setAttribute("data-msg-id", msg.id);
    div.setAttribute("data-date", msg.created_at ? msg.created_at.substring(0, 10) : "");
    div.innerHTML =
      renderAvatarHtml(getBossAvatar(), 22) +
      '<div class="msg-body">' +
      '<div class="msg-header">' + getBossName() + " \u00b7 " + formatTime(msg.created_at) + "</div>" +
      '<div class="msg-text">' + esc(msg.content) + "</div>" +
      "</div>";
  } else {
    div.className = "chat-msg";
    if (msg.id) div.setAttribute("data-msg-id", msg.id);
    var agent = agents.find(function(a) { return a.id === msg.agent_id; });
    var avatar = agent ? agent.avatar : "\u{1F916}";
    var name = agent ? (agent.nickname || agent.name) : (msg.agent_id || "Agent");
    div.setAttribute("data-date", msg.created_at ? msg.created_at.substring(0, 10) : "");
    div.innerHTML =
      renderAvatarHtml(avatar, 22) +
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

    var onlineClass = a.endpoint ? "online" : "offline";

    var displayName = a.nickname || a.name;
    var idLabel = a.id;

    card.innerHTML =
      "<div class=\"agent-card-left\">" +
      '<span class="agent-avatar">' + (a.avatar && a.avatar.indexOf('data:') === 0 ? '<img src="' + a.avatar + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover">' : a.avatar) + "</span>" +
      '<div class="agent-info">' +
      '<div class="name">' + esc(displayName) + "</div>" +
      '<div class="agent-id">' + esc(idLabel) + "</div>" +
      "</div></div>" +
      '<span class="status-dot ' + onlineClass + '" id="dot-' + a.id + '" data-online="' + (onlineClass === 'online') + '"></span>';

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
  fetch("/api/messages?room_id=room-general&limit=500")
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
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        if (!groups[key]) groups[key] = { date: d, count: 0 };
        groups[key].count++;
      });

      // Sort dates descending
      var keys = Object.keys(groups).sort(function(a,b) { return groups[b].date - groups[a].date; });
      var showAll = histList.getAttribute('data-show-all') === 'true';
      var keysToShow = showAll ? keys : keys.slice(0, 3);
      keysToShow.forEach(function(key) {
        var g = groups[key];
        var day = document.createElement("div");
        day.className = "history-day";
        var month = (g.date.getMonth() + 1) + "月" + g.date.getDate() + "日";
        day.style.cursor = "pointer";
        day.setAttribute("data-date-key", key);
        day.onclick = function() { scrollToDate(key); };
        day.innerHTML =
          "<span>" + month + "</span>" +
          '<span class="day-count">' + g.count + '条</span>' +
          '<div class="day-actions">' +
          '<button class="day-export-btn" title="导出">↗</button>' +
          '<button class="day-delete-btn danger" title="删除">✕</button>' +
          "</div>";
        var exportBtn = day.querySelector(".day-export-btn");
        if (exportBtn) {
          exportBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            exportMonthChat(key);
          });
        }
        var deleteBtn = day.querySelector(".day-delete-btn");
        if (deleteBtn) {
          deleteBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            deleteMonthChat(key);
          });
        }
        histList.appendChild(day);
      });
      // Add "more" link at bottom
      var moreBtn = document.createElement('div');
      moreBtn.className = 'history-more';
      if (!showAll && keys.length > 3) {
        moreBtn.innerHTML = '<span style="cursor:pointer;color:var(--accent-primary);font-size:12px;">\u25bc \u66f4\u591a</span>';
        moreBtn.onclick = function() { histList.setAttribute("data-show-all", "true"); loadHistorySidebar(); };
      } else if (showAll) {
        moreBtn.innerHTML = '<span style="cursor:pointer;color:var(--accent-primary);font-size:12px;">\u25b2 \u6536\u8d77</span>';
        moreBtn.onclick = function() { histList.removeAttribute("data-show-all"); loadHistorySidebar(); };
      }
      histList.appendChild(moreBtn);
    })
    .catch(function(e) { console.error("Failed to load history sidebar:", e); });
}



// ============ History Export / Delete ============

function exportMonthChat(dateKey) {
  var msgs = chatMessages.querySelectorAll(".chat-msg");
  var dayMsgs = [];
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].getAttribute("data-date") === dateKey) {
      dayMsgs.push(msgs[i]);
    }
  }
  if (dayMsgs.length === 0) {
    alert("There is nothing to export");
    return;
  }
  var parts = dateKey.split("-");
  var label = parseInt(parts[1]) + "\u6708" + parseInt(parts[2]) + "\u65e5";
  var text = "Agent Hub \u804a\u5929\u8bb0\u5f55 - " + label + "\n";
  text += "=".repeat(50) + "\n\n";
  for (var i = 0; i < dayMsgs.length; i++) {
    var sender = dayMsgs[i].querySelector(".msg-header");
    var content = dayMsgs[i].querySelector(".msg-text");
    if (sender) text += sender.textContent.trim() + "\n";
    if (content) text += content.textContent.trim() + "\n";
    text += "\n";
  }
  // Use server-side export with configured path
  var filename = "chat-history-" + dateKey + ".txt";
  fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: text, filename: filename })
  }).then(function(r) {
    if (r.ok) return r.json();
    throw new Error("Server export failed");
  }).then(function(d) {
    alert("\u5bfc\u51fa\u6210\u529f: " + d.path);
  }).catch(function() {
    // Fallback to browser download
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function deleteMonthChat(dateKey) {
  var parts = dateKey.split("-");
  var label = parseInt(parts[1]) + "月" + parseInt(parts[2]) + "日";
  if (!confirm("确定要删除 " + label + " 的聊天记录吗？此操作不可撤销。")) return;
  var msgs = document.querySelectorAll("#chatMessages .chat-msg");
  var ids = [];
  var count = 0;
  for (var i = 0; i < msgs.length; i++) {
    if (msgs[i].getAttribute("data-date") === dateKey) {
      ids.push(msgs[i].getAttribute("data-msg-id"));
      msgs[i].remove();
      count++;
    }
  }
  if (count > 0) {
    fetch("/api/messages/delete-by-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date_key: dateKey, room_id: "room-general" })
    }).catch(function(e) { console.error("Server delete error:", e); });
    loadHistorySidebar();

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
  if (!trimmed) { renderAgentSidebar(); return; }
  fetch("/api/members/" + agentId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: trimmed })
  }).then(function(r) {
    if (!r.ok) return r.json().then(function(e) { throw new Error(e.error); });
    return r.json();
  }).then(function() {
    return fetch("/api/agents");
  }).then(function(r) { return r.json(); })
  .then(function(d) {
    agents = d;
    renderAgentSidebar();
  }).catch(function(e) {
    console.error("Failed to save nickname:", e.message);
    renderAgentSidebar();
  });
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


function renderAvatarHtml(avatar, size) {
  if (avatar && avatar.indexOf("data:") === 0) {
    return "<span class=\"agent-avatar\"><img src=\"" + avatar + "\" style=\"width:" + size + "px;height:" + size + "px;border-radius:50%;object-fit:cover\"></span>";
  }
  return "<span class=\"agent-avatar\">" + (avatar || "") + "</span>";
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
function initCmdBar() {
  var cmdItems = document.querySelectorAll(".cmd-item");
  for (var i = 0; i < cmdItems.length; i++) {
    (function(el) {
      el.addEventListener("click", function() {
        var cmd = "/help";
        for (var j = 0; j < el.childNodes.length; j++) {
          if (el.childNodes[j].nodeType === 3) {
            cmd = el.childNodes[j].textContent.trim();
            break;
          }
        }
        if (cmd === "/new") {
          var cm = document.getElementById("chatMessages");
          if (cm) cm.innerHTML = "";
          return;
        }
        if (cmd === "/stop") {
          if (typeof socket !== "undefined" && socket) {
            socket.emit("chat:stop", {});
            var cm = document.getElementById("chatMessages");
            if (cm) {
              var div = document.createElement("div");
              div.className = "chat-msg system";
              div.innerHTML = "<div class=\"msg-text\">⏹️ 已发送停止指令</div>";
              cm.appendChild(div);
              cm.scrollTop = cm.scrollHeight;
            }
          }
          return;
        }
        if (cmd === "/save") {
          if (typeof exportChat === "function") exportChat();
          return;
        }
        if (cmd === "/Battle") {
          if (typeof openPick === "function") openPick();
          return;
        }
        if (cmd === "/help") {
          var cm = document.getElementById("chatMessages");
          if (cm) {
            var div = document.createElement("div");
            div.className = "chat-msg system";
            div.innerHTML = "<div class=\"msg-text\">📋 可用命令：<br>/help - 帮助<br>/stop - 停止回复<br>/new - 清屏<br>/save - 导出对话<br>/search - 搜索历史<br>/Battle - Agent 对谈</div>";
            cm.appendChild(div);
            cm.scrollTop = cm.scrollHeight;
          }
          return;
        }
        if (cmd === "/search") {
          showSearchModal();
          return;
        }
        var inputs = document.querySelectorAll("#chatInput, #messageInput, .chat-input");
        if (inputs.length) {
          inputs[0].value = cmd;
          if (typeof sendMessage === "function") sendMessage();
        }
      });
    })(cmdItems[i]);
  }
}
if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", initCmdBar); } else { initCmdBar(); }

function showSearchModal() {
  var overlay = document.getElementById("searchOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "searchOverlay";
    overlay.className = "overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:var(--overlay-bg);z-index:2000;display:flex;align-items:center;justify-content:center;";
    overlay.onclick = function(e) { if (e.target === overlay) hideSearchModal(); };
    overlay.innerHTML = "<div style=\"background:var(--bg-secondary);border-radius:12px;padding:20px;width:420px;max-width:90vw;box-shadow:var(--shadow-lg);\"><h3 style=\"margin:0 0 12px;font-size:15px;\">🔍 搜索聊天记录</h3><div style=\"display:flex;gap:8px;\"><input id=\"searchInput\" type=\"text\" placeholder=\"输入关键词...\" style=\"flex:1;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-input);color:var(--text-primary);font-size:13px;outline:none;box-sizing:border-box;\"><button onclick=\"doSearch()\" style=\"padding:8px 16px;border:none;border-radius:8px;background:var(--accent-primary);color:#fff;cursor:pointer;font-size:13px;white-space:nowrap;\">搜索</button></div><div id=\"searchResults\" style=\"margin-top:12px;max-height:300px;overflow-y:auto;font-size:13px;\"></div><button onclick=\"hideSearchModal()\" style=\"margin-top:12px;padding:7px 16px;border:none;border-radius:8px;background:var(--bg-hover);color:var(--text-primary);cursor:pointer;font-size:13px;\">关闭</button></div>";
    document.body.appendChild(overlay);
    var input = document.getElementById("searchInput");
    if (input) {
      input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") doSearch();
        if (e.key === "Escape") hideSearchModal();
      });
    }
  }
  overlay.style.display = "flex";
  var input = document.getElementById("searchInput");
  if (input) { input.value = ""; input.focus(); document.getElementById("searchResults").innerHTML = ""; }
}

function hideSearchModal() {
  var overlay = document.getElementById("searchOverlay");
  if (overlay) overlay.style.display = "none";
}

function doSearch() {
  var keyword = document.getElementById("searchInput").value.trim();
  if (!keyword) return;
  var results = document.getElementById("searchResults");
  results.innerHTML = "<div style=\"color:var(--text-muted);\">搜索中...</div>";
  fetch("/api/messages?room_id=room-general&limit=500")
    .then(function(r) { return r.json(); })
    .then(function(msgs) {
      var lowerKeyword = keyword.toLowerCase();
      var matches = [];
      for (var i = 0; i < msgs.length; i++) {
        var msg = msgs[i];
        var content = msg.content || "";
        if (content.toLowerCase().indexOf(lowerKeyword) >= 0) {
          matches.push(msg);
        }
      }
      if (matches.length === 0) {
        results.innerHTML = "<div style=\"color:var(--text-muted);padding:8px;\">未找到包含「" + keyword + "」的消息</div>";
        return;
      }
      var html = "<div style=\"color:var(--text-secondary);margin-bottom:6px;font-size:12px;\">找到 " + matches.length + " 条结果：</div>";
      for (var i = 0; i < Math.min(matches.length, 50); i++) {
        var m = matches[i];
        var label = m.role === "user" ? "🧑 我" : (m.agent_id ? "🤖 " + m.agent_id : "🤖 Agent");
        var preview = m.content.length > 120 ? m.content.substring(0, 120) + "..." : m.content;
        html += "<div class=\"search-result-item\" style=\"padding:6px 8px;border-radius:6px;cursor:pointer;margin-bottom:2px;\" onmouseover=\"this.style.background='var(--bg-hover)'\" onmouseout=\"this.style.background=''\" onclick=\"scrollToSearchResult(" + i + "," + (m.id || 0) + ")\"><div style=\"font-size:11px;color:var(--text-muted);\">" + label + "</div><div style=\"font-size:12px;color:var(--text-primary);\">" + esc(preview) + "</div></div>";
      }
      results.innerHTML = html;
    })
      // Add "more" link at bottom
    .catch(function(e) {
      results.innerHTML = "<div style=\"color:var(--accent-danger);\">搜索失败: " + e.message + "</div>";
    });
}

function scrollToSearchResult(idx, msgId) {
  var chatMsgs = document.getElementById("chatMessages");
  if (!chatMsgs) return;
  var children = chatMsgs.children;
  for (var i = 0; i < children.length; i++) {
    var textEl = children[i].querySelector(".msg-text");
    if (textEl) {
      children[i].scrollIntoView({ behavior: "smooth", block: "center" });
      children[i].style.background = "var(--accent-bg)";
      setTimeout(function(el) { return function() { el.style.background = ""; }; }(children[i]), 2000);
      break;
    }
  }
  hideSearchModal();
}

function scrollToDate(dateKey) {
  var msgs = document.getElementById("chatMessages");
  if (!msgs) return;
  var children = msgs.children;
  for (var i = 0; i < children.length; i++) {
    if (children[i].getAttribute("data-date") === dateKey) {
      children[i].scrollIntoView({ behavior: "smooth", block: "start" });
      children[i].style.background = "var(--accent-bg)";
      (function(el) {
        setTimeout(function() { el.style.background = ""; }, 2000);
      })(children[i]);
      break;
    }
  }
}

(function(){
  var s = document.createElement("style");
  s.textContent = "";
  document.head.appendChild(s);
})();

// Override Battle confirm
var _origConfirmPick = typeof confirmPick !== "undefined" ? confirmPick : function(){};
function confirmPick() {
  if (typeof picked === "undefined" || picked.length !== 2) {
    if (typeof alert === "function") alert("请选择 2 个 Agent");
    return;
  }
  var agentNames = [];
  for (var _i = 0; _i < picked.length; _i++) {
    var nameEl = picked[_i].querySelector(".name");
    if (nameEl) agentNames.push(nameEl.textContent);
  }
  if (agentNames.length < 2) { alert("无法获取 Agent 名称"); return; }
  closePick();
  
  var topic = prompt("请输入探讨话题：");
  if (!topic || !topic.trim()) return;
  
  var input = document.getElementById("chatInput");
  if (input) {
    input.value = "@" + agentNames[0] + " @" + agentNames[1] + " 请就\u300c" + topic.trim() + "\u300d展开深入探讨。双方必须以@对方开头来阐述各自观点，进行多轮辩论。";
    if (typeof sendMessage === "function") sendMessage();
  }
}
