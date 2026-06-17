// lang.js — Agent Hub i18n 语言包
// 默认英文，支持中英文切换，切换时 location.reload()

const LOCALE = { current: "en", zh: {}, en: {} };

// ============ 中文 ============
LOCALE.zh = {
  // 欢迎页
  splash_title: "Agent Hub",
  splash_welcome: "欢迎大家使用",
  splash_loading: "正在加载...",
  splash_copyright: "Agent Hub v0.1.0 © 2026 @ Leo SuN",
  splash_attribution: "大厅动画改编自 Star-Office-UI (MIT) · 像素艺术素材版权归原作者所有，仅限非商业学习使用",

  // 侧边栏
  sidebar_agents: "Agent 列表",
  sidebar_history: "聊天记录",
  sidebar_settings: "设置",

  // 命令栏
  splash_subtitle: "多智能体交流平台",
  hall_title: "大厅",
  settings_animation: "Agent 动画",
  settings_log: "日志",
  project_manage_title: "项目管理",
  project_manage_desc: "新建/重命名项目，选择参与 Agent",
  agent_manage_title: "管理 Agent",
  agent_manage_desc: "查看/编辑/移除已添加的 Agent",
  rules_title: "编辑轮次限制与 @ 模式",
  rules_desc: "设置 Agent 回复限制、@ 模式宽限规则等",
  user_settings_title: "编辑个人信息",
  user_settings_desc: "自定义头像、修改昵称",
  anim_speed_title: "动画速度",
  anim_speed_desc: "设置 Agent 消息动画速度",
  btn_open_log: "打开日志文件",
  export_save_hint: "修改后自动保存",
  theme_blue: "深海幽蓝",
  cmd_label: "命令",
  cmd_help: "帮助",
  cmd_stop: "停止",
  cmd_new: "清屏",
  cmd_save: "导出",
  cmd_battle: "Battle",
  cmd_search: "搜索",

  // 设置面板
  settings_title: "设置",
  settings_theme: "主题配色",
  settings_project: "项目管理",
  settings_agent: "Agent 管理",
  settings_rules: "发言规则",
  settings_user: "用户设置",
  settings_animation: "动画速度",
  settings_export: "导出保存位置",
  settings_language: "语言",
  theme_light: "极简白",
  theme_dark: "深色模式",
  theme_gray: "高级灰",

  // 项目管理
  project_new: "新建项目",
  project_name: "请输入项目名称",
  project_create: "创建项目",
  project_existing: "已有项目",
  project_no_projects: "暂无项目",
  project_select_agents: "选择参与 Agent：",
  project_edit: "编辑项目",
  project_delete_confirm: "确认删除项目「{name}」吗？该项目下的聊天记录也将被清除。",

  // Agent 管理
  agent_add: "添加 Agent",
  agent_manage: "管理 Agent",
  agent_edit: "编辑 Agent",
  agent_remove: "移除",
  agent_invite_title: "邀请新 Agent",
  agent_invite_next: "下一步",

  // 规则面板
  rules_rounds: "每个 Agent 每轮最多回复次数",
  rules_rounds_desc: "@提及和 Battle 模式不受限制",
  rules_custom: "自定义规则",
  rules_custom_placeholder: "一行一条规则…将作为指令发送给所有 Agent",
  rules_save: "保存规则",

  // 用户设置
  user_nickname: "昵称",
  user_avatar: "头像",

  // 动画设置
  anim_speed: "动画速度",
  anim_speed_desc: "数值越大，角色移动越快",

  // 导出
  export_save: "修改后自动保存",
  export_path_placeholder: "路径",

  // 按钮
  btn_send: "发送",
  btn_save: "保存",
  btn_back: "返回",
  btn_retry: "重试",
  btn_exit: "退出程序",

  // 弹窗
  confirm_title: "确认",
  confirm_ok: "确认",
  confirm_cancel: "取消",
  battle_title: "选择 2 个 Agent 展开探讨",
  battle_confirm: "确认",
  battle_cancel: "取消",
  search_title: "搜索聊天记录",
  search_btn: "搜索",
  search_close: "关闭",

  // 聊天
  chat_placeholder: "发送消息...（@Agent 提及，点击图标查看命令）",
  msg_cmd_hint: "输入 / 查看全部命令",
  msg_new_chat: "新对话",
  msg_joined: "加入了聊天",
  msg_left: "已移出聊天",
  msg_stop_sent: "已发送停止指令",
  msg_no_content: "（无内容可导出）",
  msg_export_ok: "导出成功: ",
  msg_export_fail: "导出失败: ",
  msg_delete_chat: "确定要删除 {label} 的聊天记录吗？此操作不可撤销。",
  msg_remove_agent: "确定要移除 Agent {id} 吗？",
  msg_battle_select: "请选择 2 个 Agent",
  msg_battle_topic: "请输入探讨话题：",
  msg_battle_names: "无法获取 Agent 名称",
  msg_export_empty: "（无内容可导出）",

  // 搜索
  search_loading: "搜索中...",
  search_no_result: "未找到包含「{keyword}」的消息",
  search_results: "找到 {count} 条结果：",
  search_fail: "搜索失败: ",

  // 帮助
  help_title: "可用命令：",
  help_stop: "停止回复",
  help_new: "清屏",
  help_save: "导出对话",
  help_search: "搜索历史",
  help_battle: "Agent 对谈",

  // 默认名称
  default_user_name: "力哥",
  nickname_placeholder: "输入昵称...",

  // Agent 状态
  msg_delete: "删除",
  btn_delete: "删除",
  msg_unknown_error: "未知错误",
  battle_prompt_format: "请就以下话题展开深入探讨。\n双方必须以@对方开头来阐述各自观点，进行多轮辩论。\n话题：{topic}",
  agent_idle: "闲置中",
  agent_thinking: "思考中...",

  // Agent 权限标签
  agent_perms_receive_all: "接收全部消息",
  agent_perms_at_only: "@提及",
  agent_perms_can_send: "可发送",
  agent_perms_history: "历史可见",

  // 命令描述
  cmd_desc_help: "命令列表",
  cmd_desc_stop: "停止回复",
  cmd_desc_new: "清空显示",
  cmd_desc_save: "保存对话",
  cmd_desc_battle: "深入探讨",
  cmd_desc_search: "搜索历史",
};

// ============ 英文 ============
LOCALE.en = {
  splash_title: "Agent Hub",
  splash_welcome: "Welcome!",
  splash_loading: "Loading...",
  splash_copyright: "Agent Hub v0.1.0 © 2026 @ Leo SuN",
  splash_attribution: "Hall animation adapted from Star-Office-UI (MIT) · Pixel art assets copyright owned by original authors, for non-commercial learning use only",

  sidebar_agents: "Agents",
  sidebar_history: "Chat History",
  sidebar_settings: "Settings",

  splash_subtitle: "Multi-Agent Collaboration Platform",
  hall_title: "Hall",
  settings_animation: "Agent Animation",
  settings_log: "Log",
  project_manage_title: "Project Management",
  project_manage_desc: "Create/rename projects, select participating Agents",
  agent_manage_title: "Manage Agents",
  agent_manage_desc: "View/edit/remove added Agents",
  rules_title: "Edit Round Limit & @ Mode",
  rules_desc: "Set Agent reply limits, @ mode override rules, etc.",
  user_settings_title: "Edit Profile",
  user_settings_desc: "Customize avatar, change nickname",
  anim_speed_title: "Animation Speed",
  anim_speed_desc: "Set Agent message animation speed",
  btn_open_log: "Open Log",
  export_save_hint: "Auto-saved on change",
  theme_blue: "Deep Blue",
  cmd_label: "Commands",
  cmd_help: "Help",
  cmd_stop: "Stop",
  cmd_new: "Clear",
  cmd_save: "Export",
  cmd_battle: "Battle",
  cmd_search: "Search",

  settings_title: "Settings",
  settings_theme: "Theme",
  settings_project: "Project Management",
  settings_agent: "Agent Management",
  settings_rules: "Speech Rules",
  settings_user: "User Settings",
  settings_animation: "Animation Speed",
  settings_export: "Export Location",
  settings_language: "Language",
  theme_light: "Light",
  theme_dark: "Dark",
  theme_gray: "Gray",

  project_new: "New Project",
  project_name: "Enter project name",
  project_create: "Create",
  project_existing: "Existing Projects",
  project_no_projects: "No projects yet",
  project_select_agents: "Select participating Agents:",
  project_edit: "Edit Project",
  project_delete_confirm: "Are you sure you want to delete \"{name}\"? All chat history under this project will also be removed.",

  agent_add: "Add Agent",
  agent_manage: "Manage Agents",
  agent_edit: "Edit Agent",
  agent_remove: "Remove",
  agent_invite_title: "Invite New Agent",
  agent_invite_next: "Next",

  rules_rounds: "Max replies per round per Agent",
  rules_rounds_desc: "@mention and Battle mode are not limited",
  rules_custom: "Custom Rules",
  rules_custom_placeholder: "One rule per line... Sent as instructions to all Agents",
  rules_save: "Save Rules",

  user_nickname: "Nickname",
  user_avatar: "Avatar",

  anim_speed: "Animation Speed",
  anim_speed_desc: "Higher values make characters move faster",

  export_save: "Auto-saved on change",
  export_path_placeholder: "Path",

  btn_send: "Send",
  btn_save: "Save",
  btn_back: "Back",
  btn_retry: "Retry",
  btn_exit: "Exit",

  confirm_title: "Confirm",
  confirm_ok: "OK",
  confirm_cancel: "Cancel",
  battle_title: "Select 2 Agents for Discussion",
  battle_confirm: "Confirm",
  battle_cancel: "Cancel",
  search_title: "Search Chat History",
  search_btn: "Search",
  search_close: "Close",

  chat_placeholder: "Type a message... (@Agent to mention, click icon for commands)",
  msg_cmd_hint: "Type / to see all commands",
  msg_new_chat: "New conversation",
  msg_joined: "joined the chat",
  msg_left: "left the chat",
  msg_stop_sent: "Stop signal sent",
  msg_no_content: "(No content)",
  msg_export_ok: "Exported: ",
  msg_export_fail: "Export failed: ",
  msg_delete_chat: "Delete chat history for {label}? This cannot be undone.",
  msg_remove_agent: "Remove Agent {id}?",
  msg_battle_select: "Please select 2 Agents",
  msg_battle_topic: "Enter discussion topic:",
  msg_battle_names: "Could not get Agent names",
  msg_export_empty: "(No content to export)",

  search_loading: "Searching...",
  search_no_result: "No results for \"{keyword}\"",
  search_results: "{count} result(s) found:",
  search_fail: "Search failed: ",

  help_title: "Available commands:",
  help_stop: "Stop replies",
  help_new: "Clear screen",
  help_save: "Export chat",
  help_search: "Search history",
  help_battle: "Agent discussion",

  default_user_name: "User",
  nickname_placeholder: "Enter nickname...",

  msg_delete: "Delete",
  btn_delete: "Delete",
  msg_unknown_error: "Unknown error",
  battle_prompt_format: "Please discuss the topic below.\nStart each response by @mentioning the other. Conduct multiple rounds of debate.\nTopic: {topic}",
  agent_idle: "Idle",
  agent_thinking: "Thinking...",

  agent_perms_receive_all: "Receive all messages",
  agent_perms_at_only: "@mention only",
  agent_perms_can_send: "Can send",
  agent_perms_history: "History visible",

  cmd_desc_help: "Command list",
  cmd_desc_stop: "Stop replies",
  cmd_desc_new: "Clear display",
  cmd_desc_save: "Export conversation",
  cmd_desc_battle: "Deep discussion",
  cmd_desc_search: "Search history",
};

// ============ 核心函数 ============

(function initLocale() {
  try {
    var saved = localStorage.getItem("hub_locale");
    if (saved === "zh" || saved === "en") LOCALE.current = saved;
  } catch(e) {}
  // 如果是因为切换语言触发的刷新，标记跳过欢迎页
  try { sessionStorage.setItem("hub_splash_done", "1"); } catch(e) {}
})();

function t(key) {
  var map = LOCALE[LOCALE.current];
  return (map && map[key] !== undefined) ? map[key] : key;
}

function setLocale(locale) {
  if (locale !== "zh" && locale !== "en") return;
  LOCALE.current = locale;
  try { localStorage.setItem("hub_locale", locale); } catch(e) {}
  location.reload();
}

// data-i18n 属性渲染（页面加载后调用）
function applyI18n() {
  var els = document.querySelectorAll("[data-i18n]");
  for (var i = 0; i < els.length; i++) {
    var key = els[i].getAttribute("data-i18n");
    if (key) els[i].textContent = t(key);
  }
  // 处理 placeholder
  var phEls = document.querySelectorAll("[data-i18n-placeholder]");
  for (var i = 0; i < phEls.length; i++) {
    var key = phEls[i].getAttribute("data-i18n-placeholder");
    if (key) phEls[i].placeholder = t(key);
  }
}


