/* ============================================================
   THE NEW DISCORD — Complete Realtime Chat Application
   Firebase Realtime Database ONLY — No Auth, No Storage
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyBrFFktufCayJJyiW7owlPQbIWKM1zBbOk",
  authDomain: "learnalgebramaximus.firebaseapp.com",
  databaseURL: "https://learnalgebramaximus-default-rtdb.firebaseio.com",
  projectId: "learnalgebramaximus",
  storageBucket: "learnalgebramaximus.firebasestorage.app",
  messagingSenderId: "581042253297",
  appId: "1:581042253297:web:a1ac31330f78b8e4c76850",
  measurementId: "G-D7D4G9VE8R"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* -------------------- CONSTANTS -------------------- */
const MAX_MSG_LEN = 2000;
const MAX_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5 MB (Base64 expands ~33%)
const MAX_PFP_SIZE = 400 * 1024;
const CHANNELS = ["rules", "general", "off-topic", "staff"];
const ROLE_EMOJI = { owner: "💻", admin: "🛡", helper: "🛠", user: "" };
const DEFAULT_AVATAR = "data:image/svg+xml;base64," + btoa(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#2a2f45"/>
  <circle cx="50" cy="38" r="20" fill="#5b6478"/>
  <ellipse cx="50" cy="85" rx="32" ry="28" fill="#5b6478"/>
</svg>`);

/* -------------------- STATE -------------------- */
let currentUser = null;
let currentChannel = "general";
let messageListener = null;
let usersCache = {};
let replyTarget = null;
let isNearBottom = true;
let muteTimer = null;
let broadcastTimer = null;
let pendingConfirm = null;
let manageTargetId = null;
let requestBlockTargetId = null;

/* -------------------- UTILITIES -------------------- */
function $(id) { return document.getElementById(id); }
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("toastContainer").appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function escapeHtml(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today at ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " at " + time;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function randomChars(n = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(password + salt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

function canSeeStaff(role) {
  return ["owner", "admin", "helper"].includes(role);
}

function hasPermission(action) {
  if (!currentUser) return false;
  const r = currentUser.role;
  const matrix = {
    send: true,
    editOwn: true,
    deleteOwn: true,
    deleteOthers: ["owner", "admin", "helper"].includes(r),
    viewStaff: canSeeStaff(r),
    broadcast: ["owner", "admin"].includes(r),
    searchUsers: canSeeStaff(r),
    grantAdmin: r === "owner",
    grantHelper: r === "owner",
    revokeStaff: r === "owner",
    block: ["owner", "admin"].includes(r),
    unblock: ["owner", "admin"].includes(r),
    requestBlock: r === "helper",
    viewBlockReq: ["owner", "admin"].includes(r),
    acceptBlock: ["owner", "admin"].includes(r),
    mute: ["owner", "admin", "helper"].includes(r),
    wipe: r === "owner"
  };
  return !!matrix[action];
}

/* -------------------- SAFE DOM -------------------- */
function createEl(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") el.className = v;
    else if (k === "textContent") el.textContent = v;
    else if (k === "innerHTML") el.innerHTML = v; // only used with already-escaped content
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  }
  return el;
}

/* -------------------- SESSION -------------------- */
function saveSession(user) {
  localStorage.setItem("tnd_session", JSON.stringify({
    userId: user.userId,
    username: user.username,
    role: user.role,
    displayName: user.displayName
  }));
}

function clearSession() {
  localStorage.removeItem("tnd_session");
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("tnd_session"));
  } catch {
    return null;
  }
}

/* -------------------- AUTH -------------------- */
async function createAccount(username, password) {
  const normalized = username.toLowerCase();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new Error("Username must be 3–16 characters: A-Z, a-z, 0-9, _ only.");
  }
  if (normalized === "owner") {
    // Allow only if no owner exists yet
    const snap = await db.ref("usernames/owner").once("value");
    if (snap.exists()) throw new Error("Username 'owner' is reserved.");
  }

  const existing = await db.ref(`usernames/${normalized}`).once("value");
  if (existing.exists()) throw new Error("Username already taken.");

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const userId = generateId();
  const now = Date.now();

  const userData = {
    username,
    normalizedUsername: normalized,
    passwordHash,
    salt,
    displayName: username,
    bio: "",
    profilePicture: DEFAULT_AVATAR,
    role: normalized === "owner" ? "owner" : "user",
    blocked: false,
    mutedUntil: null,
    createdAt: now
  };

  await db.ref(`users/${userId}`).set(userData);
  await db.ref(`usernames/${normalized}`).set(userId);
  return { userId, ...userData };
}

async function login(username, password) {
  const normalized = username.toLowerCase();
  const idSnap = await db.ref(`usernames/${normalized}`).once("value");
  if (!idSnap.exists()) throw new Error("Invalid username or password.");
  const userId = idSnap.val();
  const userSnap = await db.ref(`users/${userId}`).once("value");
  if (!userSnap.exists()) throw new Error("Invalid username or password.");
  const user = userSnap.val();
  const hash = await hashPassword(password, user.salt || "");
  if (hash !== user.passwordHash) throw new Error("Invalid username or password.");
  if (user.blocked) throw new Error("You have been blocked from this site.");
  return { userId, ...user };
}

/* -------------------- UI STATE -------------------- */
function showAuth() {
  $("authScreen").hidden = false;
  $("app").hidden = true;
  $("blockedScreen").hidden = true;
}

function showApp() {
  $("authScreen").hidden = true;
  $("blockedScreen").hidden = true;
  $("app").hidden = false;
  updateStaffVisibility();
  updateSidebarUser();
  restoreLastChannel();
}

function showBlocked() {
  $("authScreen").hidden = true;
  $("app").hidden = true;
  $("blockedScreen").hidden = false;
}

function updateStaffVisibility() {
  const staffCh = qs('.channel-item[data-channel="staff"]');
  if (canSeeStaff(currentUser.role)) {
    staffCh.hidden = false;
    $("staffControls").hidden = false;
    if (hasPermission("broadcast")) $("btnBroadcast").hidden = false;
    else $("btnBroadcast").hidden = true;
    if (hasPermission("searchUsers")) $("btnUserManager").hidden = false;
    else $("btnUserManager").hidden = true;
    if (hasPermission("viewBlockReq")) $("btnBlockRequests").hidden = false;
    else $("btnBlockRequests").hidden = true;
  } else {
    staffCh.hidden = true;
    $("staffControls").hidden = true;
  }
}

function updateSidebarUser() {
  $("sidebarAvatar").src = currentUser.profilePicture || DEFAULT_AVATAR;
  $("sidebarDisplayName").textContent = currentUser.displayName || currentUser.username;
  $("sidebarUsername").textContent = "@" + currentUser.username;
}

/* -------------------- CHANNELS -------------------- */
function switchChannel(ch) {
  if (!CHANNELS.includes(ch)) return;
  if (ch === "staff" && !canSeeStaff(currentUser.role)) {
    ch = "general";
  }
  currentChannel = ch;
  localStorage.setItem("tnd_lastChannel", ch);
  qsa(".channel-item").forEach(b => b.classList.toggle("active", b.dataset.channel === ch));
  $("channelTitle").textContent = "# " + ch;
  $("messageInput").placeholder = `Message #${ch}`;
  attachMessageListener(ch);
  $("messageList").innerHTML = "";
  $("emptyChannel").hidden = true;
  isNearBottom = true;
}

function restoreLastChannel() {
  let last = localStorage.getItem("tnd_lastChannel") || "general";
  if (last === "staff" && !canSeeStaff(currentUser.role)) last = "general";
  switchChannel(last);
}

/* -------------------- MESSAGES -------------------- */
function attachMessageListener(channel) {
  if (messageListener) {
    db.ref(`messages/${currentChannel}`).off("child_added", messageListener.added);
    db.ref(`messages/${currentChannel}`).off("child_changed", messageListener.changed);
    db.ref(`messages/${currentChannel}`).off("child_removed", messageListener.removed);
  }
  const ref = db.ref(`messages/${channel}`).orderByChild("timestamp").limitToLast(150);
  const added = ref.on("child_added", snap => {
    renderMessage(snap.key, snap.val(), true);
    if (isNearBottom) scrollToBottom();
    else $("newMessagesBtn").hidden = false;
  });
  const changed = ref.on("child_changed", snap => {
    const existing = qs(`.message[data-id="${snap.key}"]`);
    if (existing) existing.replaceWith(buildMessageEl(snap.key, snap.val()));
  });
  const removed = ref.on("child_removed", snap => {
    const existing = qs(`.message[data-id="${snap.key}"]`);
    if (existing) existing.remove();
  });
  messageListener = { added, changed, removed };
  // Check empty
  ref.once("value", snap => {
    $("emptyChannel").hidden = snap.exists();
  });
}

function buildMessageEl(id, msg) {
  const isOwn = msg.senderId === currentUser.userId;
  const canDelete = isOwn || hasPermission("deleteOthers");
  const canEdit = isOwn;
  const emoji = ROLE_EMOJI[msg.senderRole] || "";
  const display = msg.senderDisplayName || msg.senderUsername || "Unknown";

  const el = createEl("div", {
    className: "message" + (msg.replyTo && msg.replyTo.senderId === currentUser.userId ? " highlight-reply" : ""),
    dataset: { id }
  });

  const avatar = createEl("img", {
    className: "message-avatar",
    src: msg.senderProfilePicture || DEFAULT_AVATAR,
    alt: "",
    onClick: () => openViewProfile(msg.senderId)
  });

  const body = createEl("div", { className: "message-body" });

  if (msg.replyTo) {
    const ref = createEl("div", {
      className: "reply-ref",
      onClick: () => {
        const target = qs(`.message[data-id="${msg.replyTo.messageId}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    ref.innerHTML = `↩ ${escapeHtml(msg.replyTo.senderDisplayName || "")}: ${escapeHtml((msg.replyTo.textPreview || "").slice(0, 60))}`;
    body.appendChild(ref);
  }

  const header = createEl("div", { className: "message-header" });
  if (emoji) header.appendChild(createEl("span", { className: "role-emoji", textContent: emoji }));
  const author = createEl("span", {
    className: "message-author",
    textContent: display,
    onClick: () => openViewProfile(msg.senderId)
  });
  header.appendChild(author);
  header.appendChild(createEl("span", { className: "message-time", textContent: formatTime(msg.timestamp) }));
  body.appendChild(header);

  const textEl = createEl("div", { className: "message-text" });
  textEl.textContent = msg.text || "";
  if (msg.edited) {
    const ed = createEl("span", { className: "edited", textContent: "(edited)" });
    textEl.appendChild(ed);
  }
  body.appendChild(textEl);

  if (msg.attachment) {
    body.appendChild(renderAttachment(msg.attachment));
  }

  // Actions
  const actions = createEl("div", { className: "message-actions" });
  actions.appendChild(createEl("button", {
    textContent: "Reply",
    onClick: () => startReply(id, msg)
  }));
  if (canEdit) {
    actions.appendChild(createEl("button", {
      textContent: "Edit",
      onClick: () => startEdit(id, msg)
    }));
  }
  if (canDelete) {
    actions.appendChild(createEl("button", {
      textContent: "Delete",
      onClick: () => confirmDeleteMessage(id)
    }));
  }
  el.appendChild(avatar);
  el.appendChild(body);
  el.appendChild(actions);
  return el;
}

function renderMessage(id, msg, append) {
  const existing = qs(`.message[data-id="${id}"]`);
  if (existing) return;
  const el = buildMessageEl(id, msg);
  if (append) $("messageList").appendChild(el);
  else $("messageList").prepend(el);
  $("emptyChannel").hidden = true;
}

function renderAttachment(att) {
  const wrap = createEl("div", { className: "attachment" });
  const type = att.type || "";
  if (type.startsWith("image/")) {
    const img = createEl("img", { src: att.data, alt: att.name || "image" });
    wrap.appendChild(img);
  } else if (type.startsWith("video/")) {
    const vid = createEl("video", { src: att.data, controls: true });
    wrap.appendChild(vid);
  } else if (type.startsWith("audio/")) {
    const aud = createEl("audio", { src: att.data, controls: true });
    wrap.appendChild(aud);
  } else if (type === "application/pdf") {
    const a = createEl("a", {
      href: att.data,
      target: "_blank",
      textContent: "📄 " + (att.name || "PDF") + " (open)"
    });
    wrap.appendChild(a);
  } else {
    const file = createEl("div", { className: "attachment-file" });
    file.innerHTML = `<div class="meta"><div class="name">${escapeHtml(att.name || "file")}</div><div class="size">${formatSize(att.size)}</div></div>`;
    const dl = createEl("button", {
      className: "btn small",
      textContent: "Download",
      onClick: () => downloadBase64(att.data, att.name, att.type)
    });
    file.appendChild(dl);
    wrap.appendChild(file);
  }
  return wrap;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function downloadBase64(dataUrl, name, mime) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name || "download";
  a.click();
}

function scrollToBottom() {
  const area = $("messageArea");
  area.scrollTop = area.scrollHeight;
  $("newMessagesBtn").hidden = true;
  isNearBottom = true;
}

/* -------------------- SEND / EDIT / DELETE -------------------- */
async function sendMessage() {
  if (!currentUser) return;
  if (currentUser.blocked) return;
  const now = Date.now();
  if (currentUser.mutedUntil && currentUser.mutedUntil > now) {
    toast("You are muted.", "error");
    return;
  }

  const text = $("messageInput").value.trim();
  const fileInput = $("fileInput");
  let attachment = null;

  if (fileInput.files.length) {
    try {
      attachment = await fileToBase64(fileInput.files[0]);
    } catch (e) {
      toast(e.message, "error");
      return;
    }
  }

  if (!text && !attachment) return;
  if (text.length > MAX_MSG_LEN) {
    toast("Message too long.", "error");
    return;
  }

  const msgId = generateId();
  const payload = {
    senderId: currentUser.userId,
    senderUsername: currentUser.username,
    senderDisplayName: currentUser.displayName || currentUser.username,
    senderProfilePicture: currentUser.profilePicture || DEFAULT_AVATAR,
    senderRole: currentUser.role,
    text: text || "",
    timestamp: now,
    edited: false,
    replyTo: replyTarget ? {
      messageId: replyTarget.id,
      senderId: replyTarget.senderId,
      senderDisplayName: replyTarget.senderDisplayName,
      textPreview: (replyTarget.text || "").slice(0, 80)
    } : null,
    attachment
  };

  $("sendBtn").disabled = true;
  try {
    await db.ref(`messages/${currentChannel}/${msgId}`).set(payload);
    $("messageInput").value = "";
    $("charCount").textContent = "0";
    fileInput.value = "";
    cancelReply();
    scrollToBottom();
  } catch (e) {
    toast("Failed to send: " + e.message, "error");
  } finally {
    $("sendBtn").disabled = false;
  }
}

function startReply(id, msg) {
  replyTarget = { id, senderId: msg.senderId, senderDisplayName: msg.senderDisplayName || msg.senderUsername, text: msg.text };
  $("replyPreview").hidden = false;
  $("replyToName").textContent = replyTarget.senderDisplayName;
  $("replyToText").textContent = (msg.text || "").slice(0, 60);
  $("messageInput").focus();
}

function cancelReply() {
  replyTarget = null;
  $("replyPreview").hidden = true;
}

function startEdit(id, msg) {
  const newText = prompt("Edit message:", msg.text || "");
  if (newText === null) return;
  if (newText.length > MAX_MSG_LEN) {
    toast("Too long.", "error");
    return;
  }
  db.ref(`messages/${currentChannel}/${id}`).update({
    text: newText.trim(),
    edited: true
  }).then(() => toast("Message edited.", "success"))
    .catch(e => toast(e.message, "error"));
}

function confirmDeleteMessage(id) {
  showConfirm("Delete this message permanently?", async () => {
    await db.ref(`messages/${currentChannel}/${id}`).remove();
    toast("Message deleted.", "success");
  });
}

/* -------------------- FILE HANDLING -------------------- */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`File too large (max ${formatSize(MAX_FILE_SIZE)}).`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data: reader.result,
        uploadedAt: Date.now()
      });
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxDim = 512, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        resolve(new File([blob], file.name, { type: "image/jpeg" }));
      }, "image/jpeg", quality);
    };
    img.onerror = () => reject(new Error("Invalid image."));
    img.src = url;
  });
}

/* -------------------- PROFILE -------------------- */
function openProfileEdit() {
  $("editAvatar").src = currentUser.profilePicture || DEFAULT_AVATAR;
  $("editDisplayName").value = currentUser.displayName || "";
  $("editBio").value = currentUser.bio || "";
  $("dnCount").textContent = ($("editDisplayName").value || "").length;
  $("bioCount").textContent = ($("editBio").value || "").length;
  showModal("modalProfile");
}

async function saveProfile() {
  const displayName = $("editDisplayName").value.trim().slice(0, 16);
  const bio = $("editBio").value.trim().slice(0, 750);
  const updates = { displayName, bio };
  try {
    await db.ref(`users/${currentUser.userId}`).update(updates);
    currentUser.displayName = displayName;
    currentUser.bio = bio;
    saveSession(currentUser);
    updateSidebarUser();
    hideModals();
    toast("Profile updated.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function changeProfilePicture(file) {
  if (!file.type.startsWith("image/")) {
    toast("Please select an image.", "error");
    return;
  }
  try {
    const compressed = await compressImage(file, 256, 0.65);
    if (compressed.size > MAX_PFP_SIZE) {
      toast("Image still too large after compression.", "error");
      return;
    }
    const data = await fileToBase64(compressed);
    await db.ref(`users/${currentUser.userId}/profilePicture`).set(data.data);
    currentUser.profilePicture = data.data;
    $("editAvatar").src = data.data;
    $("sidebarAvatar").src = data.data;
    toast("Picture updated.", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

function openViewProfile(userId) {
  db.ref(`users/${userId}`).once("value").then(snap => {
    if (!snap.exists()) return;
    const u = snap.val();
    $("viewAvatar").src = u.profilePicture || DEFAULT_AVATAR;
    $("viewDisplayName").textContent = u.displayName || u.username;
    $("viewUsername").textContent = "@" + u.username;
    $("viewRole").textContent = (ROLE_EMOJI[u.role] || "") + " " + (u.role || "user");
    $("viewBio").textContent = u.bio || "No bio.";
    showModal("modalViewProfile");
  });
}

/* -------------------- MODERATION -------------------- */
function showConfirm(text, onYes) {
  $("confirmText").textContent = text;
  pendingConfirm = onYes;
  showModal("modalConfirm");
}

async function openUserManager() {
  $("userSearch").value = "";
  showModal("modalUserManager");
  loadUserList("");
}

function loadUserList(query) {
  const list = $("userList");
  list.innerHTML = "";
  db.ref("users").once("value").then(snap => {
    const users = [];
    snap.forEach(c => {
      const u = c.val();
      u.userId = c.key;
      users.push(u);
    });
    const q = query.toLowerCase();
    const filtered = q
      ? users.filter(u => (u.username || "").toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q))
      : users;
    if (!filtered.length) {
      list.innerHTML = '<p class="empty-state">No users found.</p>';
      return;
    }
    filtered.sort((a, b) => (a.username || "").localeCompare(b.username || ""));
    filtered.forEach(u => {
      const item = createEl("div", {
        className: "user-item",
        onClick: () => openManageUser(u.userId)
      });
      const img = createEl("img", { className: "avatar", src: u.profilePicture || DEFAULT_AVATAR });
      const info = createEl("div", { className: "info" });
      info.innerHTML = `<div class="display-name">${escapeHtml(u.displayName || u.username)}</div>
        <div class="username">@${escapeHtml(u.username)} · ${escapeHtml(u.role || "user")}</div>`;
      item.appendChild(img);
      item.appendChild(info);
      list.appendChild(item);
    });
  });
}

function openManageUser(userId) {
  manageTargetId = userId;
  db.ref(`users/${userId}`).once("value").then(snap => {
    if (!snap.exists()) return;
    const u = snap.val();
    $("manageAvatar").src = u.profilePicture || DEFAULT_AVATAR;
    $("manageDisplayName").textContent = u.displayName || u.username;
    $("manageUsername").textContent = "@" + u.username;
    $("manageRole").textContent = (ROLE_EMOJI[u.role] || "") + " " + (u.role || "user");
    const actions = $("manageActions");
    actions.innerHTML = "";

    if (u.role === "owner") {
      actions.innerHTML = "<p style='color:var(--text-muted)'>Owner cannot be modified.</p>";
    } else {
      if (hasPermission("grantAdmin") && u.role !== "admin") {
        actions.appendChild(createEl("button", { className: "btn small", textContent: "Grant Admin", onClick: () => setRole(userId, "admin") }));
      }
      if (hasPermission("grantHelper") && u.role !== "helper") {
        actions.appendChild(createEl("button", { className: "btn small", textContent: "Grant Helper", onClick: () => setRole(userId, "helper") }));
      }
      if (hasPermission("revokeStaff") && (u.role === "admin" || u.role === "helper")) {
        actions.appendChild(createEl("button", { className: "btn small", textContent: "Revoke to User", onClick: () => setRole(userId, "user") }));
      }
      if (hasPermission("block")) {
        if (u.blocked) {
          actions.appendChild(createEl("button", { className: "btn small", textContent: "Unblock", onClick: () => setBlocked(userId, false) }));
        } else {
          actions.appendChild(createEl("button", { className: "btn small danger", textContent: "Block", onClick: () => setBlocked(userId, true) }));
        }
      }
      if (hasPermission("mute")) {
        actions.appendChild(createEl("button", { className: "btn small", textContent: "Mute 1 min", onClick: () => muteUser(userId, 60) }));
        actions.appendChild(createEl("button", { className: "btn small", textContent: "Mute 5 min", onClick: () => muteUser(userId, 300) }));
        actions.appendChild(createEl("button", { className: "btn small", textContent: "Mute 10 min", onClick: () => muteUser(userId, 600) }));
      }
      if (hasPermission("requestBlock") && !u.blocked) {
        actions.appendChild(createEl("button", { className: "btn small danger", textContent: "Request Block", onClick: () => openRequestBlock(userId, u.username) }));
      }
      if (hasPermission("wipe")) {
        actions.appendChild(createEl("button", { className: "btn small danger", textContent: "Wipe Account", onClick: () => confirmWipe(userId) }));
      }
    }
    showModal("modalManageUser");
  });
}

async function setRole(userId, role) {
  if (role === "owner") return;
  await db.ref(`users/${userId}/role`).set(role);
  toast("Role updated.", "success");
  openManageUser(userId);
}

async function setBlocked(userId, blocked) {
  await db.ref(`users/${userId}/blocked`).set(blocked);
  toast(blocked ? "User blocked." : "User unblocked.", "success");
  openManageUser(userId);
}

async function muteUser(userId, seconds) {
  const until = Date.now() + seconds * 1000;
  await db.ref(`users/${userId}/mutedUntil`).set(until);
  toast(`Muted for ${seconds}s.`, "success");
}

function openRequestBlock(userId, username) {
  requestBlockTargetId = userId;
  $("reqBlockTarget").textContent = username;
  $("blockReason").value = "";
  showModal("modalRequestBlock");
}

async function submitBlockRequest() {
  const reason = $("blockReason").value.trim();
  if (!reason) { toast("Reason required.", "error"); return; }
  const id = generateId();
  await db.ref(`blockRequests/${id}`).set({
    targetUserId: requestBlockTargetId,
    requestedBy: currentUser.userId,
    reason,
    createdAt: Date.now()
  });
  hideModals();
  toast("Block request submitted.", "success");
}

function loadBlockRequests() {
  const list = $("blockRequestList");
  list.innerHTML = "";
  db.ref("blockRequests").once("value").then(snap => {
    if (!snap.exists()) {
      $("noBlockRequests").hidden = false;
      $("blockReqDot").hidden = true;
      return;
    }
    $("noBlockRequests").hidden = true;
    let count = 0;
    snap.forEach(c => {
      count++;
      const r = c.val();
      const item = createEl("div", { className: "block-req-item" });
      const info = createEl("div", { className: "info" });
      info.innerHTML = `<div>Target: ${escapeHtml(r.targetUserId)}</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">Reason: ${escapeHtml(r.reason)}</div>`;
      const actions = createEl("div");
      actions.appendChild(createEl("button", {
        className: "btn small danger",
        textContent: "Accept",
        onClick: async () => {
          await db.ref(`users/${r.targetUserId}/blocked`).set(true);
          await db.ref(`blockRequests/${c.key}`).remove();
          toast("User blocked.", "success");
          loadBlockRequests();
        }
      }));
      actions.appendChild(createEl("button", {
        className: "btn small",
        textContent: "Deny",
        onClick: async () => {
          await db.ref(`blockRequests/${c.key}`).remove();
          toast("Request denied.", "info");
          loadBlockRequests();
        }
      }));
      item.appendChild(info);
      item.appendChild(actions);
      list.appendChild(item);
    });
    $("blockReqDot").hidden = count === 0;
  });
}

function confirmWipe(userId) {
  showConfirm("Wipe this account? Profile will be reset and username changed.", async () => {
    await wipeAccount(userId);
    hideModals();
    toast("Account wiped.", "success");
  });
}

async function wipeAccount(userId) {
  const userRef = db.ref(`users/${userId}`);
  const snap = await userRef.once("value");
  if (!snap.exists()) return;
  const old = snap.val();
  // Release old username
  if (old.normalizedUsername) {
    await db.ref(`usernames/${old.normalizedUsername}`).remove();
  }
  // Generate unique new username
  let newName, newNorm;
  for (let i = 0; i < 20; i++) {
    newName = "user_" + randomChars(6);
    newNorm = newName.toLowerCase();
    const exists = await db.ref(`usernames/${newNorm}`).once("value");
    if (!exists.exists()) break;
  }
  await db.ref(`usernames/${newNorm}`).set(userId);
  await userRef.update({
    username: newName,
    normalizedUsername: newNorm,
    displayName: "",
    bio: "",
    profilePicture: DEFAULT_AVATAR
  });
}

/* -------------------- BROADCAST -------------------- */
function openBroadcast() {
  $("broadcastMsg").value = "";
  $("broadcastDuration").value = 10;
  showModal("modalBroadcast");
}

async function sendBroadcast() {
  const msg = $("broadcastMsg").value.trim();
  let dur = parseInt($("broadcastDuration").value, 10);
  if (!msg) { toast("Message required.", "error"); return; }
  if (isNaN(dur) || dur < 3) dur = 3;
  if (dur > 20) dur = 20;
  const now = Date.now();
  await db.ref("broadcast/current").set({
    message: msg,
    createdBy: currentUser.userId,
    startedAt: now,
    expiresAt: now + dur * 1000
  });
  hideModals();
  toast("Broadcast sent.", "success");
}

function listenBroadcast() {
  db.ref("broadcast/current").on("value", snap => {
    const b = snap.val();
    if (!b || !b.expiresAt || b.expiresAt < Date.now()) {
      $("broadcastBanner").hidden = true;
      if (broadcastTimer) clearInterval(broadcastTimer);
      return;
    }
    $("broadcastBanner").hidden = false;
    $("broadcastText").textContent = b.message;
    const updateTimer = () => {
      const left = Math.max(0, Math.ceil((b.expiresAt - Date.now()) / 1000));
      $("broadcastTimer").textContent = left + "s";
      if (left <= 0) {
        $("broadcastBanner").hidden = true;
        clearInterval(broadcastTimer);
      }
    };
    updateTimer();
    if (broadcastTimer) clearInterval(broadcastTimer);
    broadcastTimer = setInterval(updateTimer, 1000);
  });
}

/* -------------------- MUTE / BLOCK LISTENERS -------------------- */
function listenSelfStatus() {
  db.ref(`users/${currentUser.userId}`).on("value", snap => {
    if (!snap.exists()) {
      logout();
      return;
    }
    const u = snap.val();
    currentUser = { ...currentUser, ...u, userId: currentUser.userId };
    if (u.blocked) {
      showBlocked();
      return;
    }
    // Mute UI
    const now = Date.now();
    if (u.mutedUntil && u.mutedUntil > now) {
      $("muteBanner").hidden = false;
      $("sendBtn").disabled = true;
      $("messageInput").disabled = true;
      const updateMute = () => {
        const left = Math.max(0, Math.ceil((u.mutedUntil - Date.now()) / 1000));
        $("muteRemaining").textContent = left + "s";
        if (left <= 0) {
          $("muteBanner").hidden = true;
          $("sendBtn").disabled = false;
          $("messageInput").disabled = false;
          clearInterval(muteTimer);
        }
      };
      updateMute();
      if (muteTimer) clearInterval(muteTimer);
      muteTimer = setInterval(updateMute, 1000);
    } else {
      $("muteBanner").hidden = true;
      $("sendBtn").disabled = false;
      $("messageInput").disabled = false;
    }
    updateSidebarUser();
    updateStaffVisibility();
  });
}

function listenBlockRequests() {
  if (!hasPermission("viewBlockReq")) return;
  db.ref("blockRequests").on("value", snap => {
    $("blockReqDot").hidden = !snap.exists();
  });
}

/* -------------------- CONNECTION -------------------- */
function listenConnection() {
  const connectedRef = db.ref(".info/connected");
  connectedRef.on("value", snap => {
    const status = $("connectionStatus");
    if (snap.val() === true) {
      status.textContent = "Connected";
      status.className = "connection-status connected";
    } else {
      status.textContent = "Reconnecting…";
      status.className = "connection-status offline";
    }
  });
}

/* -------------------- MODALS -------------------- */
function showModal(id) {
  $("modalOverlay").hidden = false;
  qsa(".modal").forEach(m => m.hidden = true);
  $(id).hidden = false;
}

function hideModals() {
  $("modalOverlay").hidden = true;
  qsa(".modal").forEach(m => m.hidden = true);
  pendingConfirm = null;
}

/* -------------------- LOGOUT -------------------- */
function logout() {
  if (messageListener) {
    db.ref(`messages/${currentChannel}`).off();
    messageListener = null;
  }
  db.ref(`users/${currentUser?.userId}`).off();
  db.ref("broadcast/current").off();
  db.ref("blockRequests").off();
  clearSession();
  currentUser = null;
  showAuth();
}

/* -------------------- INIT -------------------- */
async function restoreSession() {
  const sess = loadSession();
  if (!sess) {
    showAuth();
    return;
  }
  try {
    const snap = await db.ref(`users/${sess.userId}`).once("value");
    if (!snap.exists()) {
      clearSession();
      showAuth();
      return;
    }
    const u = snap.val();
    if (u.blocked) {
      currentUser = { userId: sess.userId, ...u };
      showBlocked();
      return;
    }
    currentUser = { userId: sess.userId, ...u };
    showApp();
    listenSelfStatus();
    listenBroadcast();
    listenBlockRequests();
    listenConnection();
  } catch (e) {
    clearSession();
    showAuth();
  }
}

function bindEvents() {
  // Auth tabs
  $("tabLogin").onclick = () => {
    $("tabLogin").classList.add("active");
    $("tabRegister").classList.remove("active");
    $("authSubmit").textContent = "Login";
  };
  $("tabRegister").onclick = () => {
    $("tabRegister").classList.add("active");
    $("tabLogin").classList.remove("active");
    $("authSubmit").textContent = "Create Account";
  };

  $("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const username = $("authUsername").value.trim();
    const password = $("authPassword").value;
    $("authError").hidden = true;
    $("authLoading").hidden = false;
    $("authSubmit").disabled = true;
    try {
      let user;
      if ($("tabRegister").classList.contains("active")) {
        user = await createAccount(username, password);
        toast("Account created!", "success");
      } else {
        user = await login(username, password);
      }
      currentUser = user;
      saveSession(user);
      showApp();
      listenSelfStatus();
      listenBroadcast();
      listenBlockRequests();
      listenConnection();
    } catch (err) {
      $("authError").textContent = err.message;
      $("authError").hidden = false;
    } finally {
      $("authLoading").hidden = true;
      $("authSubmit").disabled = false;
    }
  };

  // Channels
  qsa(".channel-item").forEach(btn => {
    btn.onclick = () => switchChannel(btn.dataset.channel);
  });

  // Composer
  $("sendBtn").onclick = sendMessage;
  $("messageInput").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  $("messageInput").oninput = () => {
    $("charCount").textContent = $("messageInput").value.length;
    $("messageInput").style.height = "auto";
    $("messageInput").style.height = Math.min($("messageInput").scrollHeight, 140) + "px";
  };
  $("cancelReply").onclick = cancelReply;
  $("fileInput").onchange = () => {
    if ($("fileInput").files.length) toast("File attached (will send with message).", "info");
  };

  // Sidebar
  $("btnProfile").onclick = openProfileEdit;
  $("btnLogout").onclick = logout;
  $("mobileOpenSidebar").onclick = () => $("sidebar").classList.add("open");
  $("mobileCloseSidebar").onclick = () => $("sidebar").classList.remove("open");

  // Staff
  $("btnBroadcast").onclick = openBroadcast;
  $("btnUserManager").onclick = openUserManager;
  $("btnBlockRequests").onclick = () => { showModal("modalBlockRequests"); loadBlockRequests(); };

  // Profile modal
  $("saveProfile").onclick = saveProfile;
  $("profilePicInput").onchange = (e) => {
    if (e.target.files[0]) changeProfilePicture(e.target.files[0]);
  };
  $("editDisplayName").oninput = () => $("dnCount").textContent = $("editDisplayName").value.length;
  $("editBio").oninput = () => $("bioCount").textContent = $("editBio").value.length;

  // Broadcast
  $("sendBroadcast").onclick = sendBroadcast;

  // User search
  $("userSearch").oninput = () => loadUserList($("userSearch").value);

  // Request block
  $("submitBlockRequest").onclick = submitBlockRequest;

  // Confirm
  $("confirmYes").onclick = () => {
    if (pendingConfirm) pendingConfirm();
    hideModals();
  };

  // Close modals
  qsa(".modal-close").forEach(b => b.onclick = hideModals);
  $("modalOverlay").onclick = (e) => { if (e.target === $("modalOverlay")) hideModals(); };
  document.onkeydown = (e) => {
    if (e.key === "Escape") hideModals();
  };

  // Scroll detection
  $("messageArea").onscroll = () => {
    const area = $("messageArea");
    isNearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 120;
    if (isNearBottom) $("newMessagesBtn").hidden = true;
  };
  $("newMessagesBtn").onclick = scrollToBottom;
}

/* -------------------- BOOT -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  restoreSession();
});
