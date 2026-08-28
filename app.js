// ============================================================
// THE NEW DISCORD — app.js
// Vanilla JS + Firebase Realtime Database only (no Auth, no Storage)
//
// This file is loaded from index.html as <script type="module">,
// which is what lets it use these import statements directly.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, update, remove, push,
  onValue, off, query, orderByChild, equalTo, serverTimestamp,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ---------------------------------------------------------------
// FIREBASE CONFIG — paste your project's values here.
// Firebase Console → Project Settings (gear icon) → General tab →
// "Your apps" → SDK setup and configuration → Config
// ---------------------------------------------------------------
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

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ---------------- Constants ----------------
const CHANNELS = ["rules", "general", "off-topic", "staff"];
const STAFF_ROLES = ["owner", "admin", "helper"];
const USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;
const MAX_MSG_LEN = 2000;
const MAX_DISPLAY_NAME_LEN = 16;
const MAX_BIO_LEN = 750;
const MAX_BROADCAST_LEN = 300;
const MAX_REASON_LEN = 300;
const MIN_BROADCAST_SEC = 3;
const MAX_BROADCAST_SEC = 20;
const MIN_MUTE_SEC = 30;
const MAX_MUTE_SEC = 600;
const MAX_FILE_BYTES = 4.5 * 1024 * 1024; // pre-Base64 cap; ~6MB after encoding
const MAX_AVATAR_DIMENSION = 256;
const SESSION_KEY = "tnd_session_v1";
const LAST_CHANNEL_KEY = "tnd_last_channel_v1";

const DEFAULT_AVATAR_SVG = buildDefaultAvatarSvg();

// ---------------- App state ----------------
const state = {
  currentUser: null,        // full user record incl. internal fields we keep client-side
  currentUid: null,
  currentChannel: "general",
  messageListeners: {},     // channel -> unsubscribe fn
  userListeners: [],        // misc unsubscribe fns (block/mute/role watchers etc.)
  usersCache: {},           // uid -> user record (lightweight, for rendering names/avatars)
  allUsersLoaded: false,
  replyTarget: null,        // { id, authorName, snippet }
  pendingFile: null,        // { name, type, size, base64 }
  muteTimer: null,
  broadcastTimer: null,
  isNearBottom: true,
  activeManagedUid: null,   // uid currently open in the manage-user modal
};

// ---------------- DOM refs ----------------
const $ = (id) => document.getElementById(id);

const el = {
  loadingScreen: $("loading-screen"),
  authScreen: $("auth-screen"),
  blockedScreen: $("blocked-screen"),
  mainApp: $("main-app"),

  tabLogin: $("tab-login"),
  tabSignup: $("tab-signup"),
  authForm: $("auth-form"),
  authUsername: $("auth-username"),
  authPassword: $("auth-password"),
  authError: $("auth-error"),
  authSubmit: $("auth-submit"),
  authSubmitLabel: $("auth-submit-label"),
  authSubmitSpinner: $("auth-submit-spinner"),

  blockedLogoutBtn: $("blocked-logout-btn"),

  broadcastBanner: $("broadcast-banner"),
  broadcastText: $("broadcast-text"),

  sidebar: $("sidebar"),
  sidebarToggle: $("sidebar-toggle"),
  mobileSidebarBtn: $("mobile-sidebar-btn"),
  connectionStatus: $("connection-status"),
  statusDot: $("status-dot"),
  statusLabel: $("status-label"),
  channelList: $("channel-list"),

  userPanelAvatarBtn: $("user-panel-avatar-btn"),
  userPanelAvatar: $("user-panel-avatar"),
  userPanelName: $("user-panel-name"),
  userPanelRole: $("user-panel-role"),
  profileBtn: $("profile-btn"),
  logoutBtn: $("logout-btn"),

  channelNameDisplay: $("channel-name-display"),
  staffControls: $("staff-controls"),
  messagesScroll: $("messages-scroll"),
  messagesList: $("messages-list"),
  emptyChannelState: $("empty-channel-state"),
  newMessagesBtn: $("new-messages-btn"),

  muteNotice: $("mute-notice"),
  muteRemaining: $("mute-remaining"),

  replyPreview: $("reply-preview"),
  replyPreviewName: $("reply-preview-name"),
  replyPreviewSnippet: $("reply-preview-snippet"),
  cancelReplyBtn: $("cancel-reply-btn"),

  fileUploadBtn: $("file-upload-btn"),
  fileInput: $("file-input"),
  messageInput: $("message-input"),
  sendBtn: $("send-btn"),
  filePreview: $("file-preview"),

  modalOverlay: $("modal-overlay"),

  modalProfile: $("modal-profile"),
  profileDisplayName: $("profile-display-name"),
  profileBio: $("profile-bio"),
  dnCounter: $("dn-counter"),
  bioCounter: $("bio-counter"),
  profileError: $("profile-error"),
  profileSaveBtn: $("profile-save-btn"),

  modalViewProfile: $("modal-view-profile"),
  vpAvatar: $("vp-avatar"),
  vpDisplayName: $("vp-display-name"),
  vpUsername: $("vp-username"),
  vpRole: $("vp-role"),
  vpBio: $("vp-bio"),

  modalStaffMenu: $("modal-staff-menu"),
  staffBroadcastBtn: $("staff-broadcast-btn"),
  staffUsermanagerBtn: $("staff-usermanager-btn"),
  staffBlockrequestsBtn: $("staff-blockrequests-btn"),
  blockRequestsDot: $("block-requests-dot"),

  modalBroadcast: $("modal-broadcast"),
  broadcastMessage: $("broadcast-message"),
  broadcastCounter: $("broadcast-counter"),
  broadcastDuration: $("broadcast-duration"),
  broadcastError: $("broadcast-error"),
  broadcastSendBtn: $("broadcast-send-btn"),

  modalUsermanager: $("modal-usermanager"),
  userSearchInput: $("user-search-input"),
  userSearchResults: $("user-search-results"),

  modalManageUser: $("modal-manage-user"),
  muAvatar: $("mu-avatar"),
  muDisplayName: $("mu-display-name"),
  muUsername: $("mu-username"),
  muActions: $("mu-actions"),

  modalBlockReason: $("modal-block-reason"),
  blockReasonInput: $("block-reason-input"),
  reasonCounter: $("reason-counter"),
  blockReasonError: $("block-reason-error"),
  blockReasonSubmit: $("block-reason-submit"),

  modalBlockRequests: $("modal-block-requests"),
  blockRequestsList: $("block-requests-list"),
  blockRequestsEmpty: $("block-requests-empty"),

  modalConfirm: $("modal-confirm"),
  confirmTitle: $("confirm-title"),
  confirmMessage: $("confirm-message"),
  confirmActionBtn: $("confirm-action-btn"),

  toastContainer: $("toast-container"),
};

// ============================================================
// SAFE RENDERING HELPERS — never use innerHTML with user content
// ============================================================

function textNode(str) {
  return document.createTextNode(str == null ? "" : String(str));
}

function makeEl(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.appendChild(textNode(opts.text));
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  return node;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function safeAvatarSrc(pic) {
  if (typeof pic === "string" && pic.startsWith("data:image")) return pic;
  return DEFAULT_AVATAR_SVG;
}

function buildDefaultAvatarSvg() {
  // Simple neutral generated avatar, inlined as a data URL (no external asset, no Storage).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7c6cf6"/>
        <stop offset="100%" stop-color="#a06cf6"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="50" fill="url(#g)"/>
    <circle cx="50" cy="40" r="18" fill="rgba(255,255,255,0.85)"/>
    <path d="M20 88 Q50 58 80 88 Z" fill="rgba(255,255,255,0.85)"/>
  </svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}

// ============================================================
// TOASTS
// ============================================================

function showToast(message, type = "info") {
  const toast = makeEl("div", { className: `toast ${type}`, text: message });
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    setTimeout(() => toast.remove(), 260);
  }, 3400);
}

// ============================================================
// MODAL SYSTEM
// ============================================================

const ALL_MODALS = [
  "modalProfile", "modalViewProfile", "modalStaffMenu", "modalBroadcast",
  "modalUsermanager", "modalManageUser", "modalBlockReason",
  "modalBlockRequests", "modalConfirm",
];

function openModal(key) {
  el.modalOverlay.classList.remove("hidden");
  for (const k of ALL_MODALS) el[k].classList.toggle("hidden", k !== key);
}

function closeModals() {
  el.modalOverlay.classList.add("hidden");
  for (const k of ALL_MODALS) el[k].classList.add("hidden");
}

el.modalOverlay.addEventListener("click", (e) => {
  if (e.target === el.modalOverlay) closeModals();
});
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", closeModals);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.modalOverlay.classList.contains("hidden")) closeModals();
});

function askConfirm(title, message, onConfirm) {
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  openModal("modalConfirm");
  const handler = () => {
    closeModals();
    el.confirmActionBtn.removeEventListener("click", handler);
    onConfirm();
  };
  // Remove any previous handler by cloning the button
  const fresh = el.confirmActionBtn.cloneNode(true);
  el.confirmActionBtn.parentNode.replaceChild(fresh, el.confirmActionBtn);
  el.confirmActionBtn = fresh;
  el.confirmActionBtn.addEventListener("click", handler);
}

// ============================================================
// PASSWORD HASHING (Web Crypto SHA-256 + per-user random salt)
//
// NOTE ON SECURITY: this is a client-side, database-only scheme as
// required by this project's constraints (no Firebase Auth). It is
// NOT equivalent to a real authentication system. Anyone who can
// read the Realtime Database (which, without Auth-backed rules, is
// a lower bar than normal) can see password hashes and attempt
// offline cracking. Treat this as appropriate for a low-stakes
// community project, not for anything handling sensitive data.
// ============================================================

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bufToHex(arr.buffer);
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const data = enc.encode(saltHex + ":" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(digest);
}

// ============================================================
// USERNAME HELPERS
// ============================================================

function normalizeUsername(username) {
  return (username || "").trim().toLowerCase();
}

function isValidUsernameFormat(username) {
  return USERNAME_REGEX.test(username || "");
}

async function isUsernameTaken(normalized) {
  const snap = await get(ref(db, `usernames/${normalized}`));
  return snap.exists();
}

function randomSixChars() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) out += chars[arr[i] % chars.length];
  return out;
}

async function generateUniqueWipedUsername() {
  // Keep trying until we find a free "user_xxxxxx" slot.
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = `user_${randomSixChars()}`;
    const normalized = normalizeUsername(candidate);
    const taken = await isUsernameTaken(normalized);
    if (!taken) return candidate;
  }
  throw new Error("Could not generate a unique username after multiple attempts.");
}

// ============================================================
// SESSION PERSISTENCE (localStorage — no Firebase Auth)
// ============================================================

function saveSession(uid) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ uid, savedAt: Date.now() }));
  } catch (e) {
    console.warn("Could not persist session:", e);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.uid) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* ignore */ }
}

function saveLastChannel(channel) {
  try { localStorage.setItem(LAST_CHANNEL_KEY, channel); } catch (e) { /* ignore */ }
}

function loadLastChannel() {
  try { return localStorage.getItem(LAST_CHANNEL_KEY); } catch (e) { return null; }
}

// ============================================================
// ACCOUNT CREATION
// ============================================================

async function createAccount(rawUsername, password) {
  const username = (rawUsername || "").trim();
  const normalized = normalizeUsername(username);

  if (!isValidUsernameFormat(username)) {
    throw new Error("Username must be 3-16 characters: letters, numbers, and underscores only.");
  }
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }
  if (normalized === "owner") {
    // The 'owner' username is reserved for the single designated Owner account.
    // We still allow *creating* it once (so the site has an owner), but only
    // ever grant the 'owner' role to exactly this username, enforced in
    // determineRoleForUsername() below — never through any UI control.
  }

  if (await isUsernameTaken(normalized)) {
    throw new Error("That username is already taken.");
  }

  const salt = randomSaltHex();
  const passwordHash = await hashPassword(password, salt);

  const newUserRef = push(ref(db, "users"));
  const uid = newUserRef.key;

  const role = determineRoleForUsername(normalized);

  const userRecord = {
    username,
    normalizedUsername: normalized,
    passwordHash,
    passwordSalt: salt,
    displayName: "",
    bio: "",
    profilePicture: null, // null => render DEFAULT_AVATAR_SVG client-side
    role,
    blocked: false,
    mutedUntil: 0,
    createdAt: serverTimestamp(),
  };

  await set(newUserRef, userRecord);
  await set(ref(db, `usernames/${normalized}`), uid);

  return uid;
}

function determineRoleForUsername(normalized) {
  // The ONLY way to become Owner: your normalized username is exactly "owner".
  // This function is the single source of truth for that rule — no UI control
  // anywhere in this app ever sets role to "owner".
  if (normalized === "owner") return "owner";
  return "user";
}

// ============================================================
// LOGIN
// ============================================================

async function loginWithCredentials(rawUsername, password) {
  const normalized = normalizeUsername(rawUsername);
  const uidSnap = await get(ref(db, `usernames/${normalized}`));
  if (!uidSnap.exists()) {
    throw new Error("Incorrect username or password.");
  }
  const uid = uidSnap.val();

  const userSnap = await get(ref(db, `users/${uid}`));
  if (!userSnap.exists()) {
    throw new Error("Incorrect username or password.");
  }
  const userRecord = userSnap.val();

  const attemptedHash = await hashPassword(password, userRecord.passwordSalt);
  if (attemptedHash !== userRecord.passwordHash) {
    throw new Error("Incorrect username or password.");
  }

  if (userRecord.blocked) {
    // Let them "log in" so we can show the blocked screen with context,
    // rather than a generic error that looks like a wrong password.
    return { uid, userRecord, blocked: true };
  }

  return { uid, userRecord, blocked: false };
}

// ============================================================
// SESSION RESTORATION / BOOTSTRAP
// ============================================================

async function bootstrapSession() {
  const session = loadSession();
  if (!session) {
    showAuthScreen();
    return;
  }

  try {
    const userSnap = await get(ref(db, `users/${session.uid}`));
    if (!userSnap.exists()) {
      // Account no longer exists (e.g. manually removed) — clear stale session.
      clearSession();
      showAuthScreen();
      return;
    }
    const userRecord = userSnap.val();

    if (userRecord.blocked) {
      state.currentUid = session.uid;
      state.currentUser = userRecord;
      showBlockedScreen();
      watchOwnBlockStatus(session.uid); // so an unblock still resolves live
      return;
    }

    enterApp(session.uid, userRecord);
  } catch (e) {
    console.error("Session restore failed:", e);
    showAuthScreen();
  }
}

function enterApp(uid, userRecord) {
  state.currentUid = uid;
  state.currentUser = userRecord;
  saveSession(uid);

  renderUserPanel();
  renderChannelList();
  setupStaffControls();
  watchOwnBlockStatus(uid);
  watchOwnMuteStatus(uid);
  watchOwnRoleChanges(uid);
  watchBroadcast();
  if (isStaff(userRecord.role)) watchBlockRequestsDot();

  const remembered = loadLastChannel();
  const initialChannel = (remembered && CHANNELS.includes(remembered)) ? remembered : "general";
  switchChannel(canAccessChannel(initialChannel, userRecord.role) ? initialChannel : "general");

  showMainApp();
}

function logout() {
  // Tear down listeners first to avoid leaks / stray callbacks after logout.
  teardownAllListeners();
  clearSession();
  state.currentUser = null;
  state.currentUid = null;
  showAuthScreen();
}

function teardownAllListeners() {
  for (const unsub of Object.values(state.messageListeners)) {
    try { unsub(); } catch (e) { /* ignore */ }
  }
  state.messageListeners = {};
  for (const unsub of state.userListeners) {
    try { unsub(); } catch (e) { /* ignore */ }
  }
  state.userListeners = [];
  if (state.muteTimer) clearInterval(state.muteTimer);
  if (state.broadcastTimer) clearTimeout(state.broadcastTimer);
}

// ============================================================
// SCREEN SWITCHING
// ============================================================

function showScreen(screenEl) {
  [el.loadingScreen, el.authScreen, el.blockedScreen, el.mainApp].forEach((s) => {
    s.classList.toggle("hidden", s !== screenEl);
  });
}
function showLoadingScreen() { showScreen(el.loadingScreen); }
function showAuthScreen() { showScreen(el.authScreen); resetAuthForm(); }
function showBlockedScreen() { showScreen(el.blockedScreen); }
function showMainApp() { showScreen(el.mainApp); }

// ============================================================
// PERMISSIONS
// ============================================================

function isStaff(role) { return STAFF_ROLES.includes(role); }
function isOwner(role) { return role === "owner"; }
function isAdminOrOwner(role) { return role === "owner" || role === "admin"; }

function canAccessChannel(channel, role) {
  if (channel === "staff") return isStaff(role);
  return CHANNELS.includes(channel);
}

function canDeleteMessage(message, viewerUid, viewerRole) {
  if (message.senderId === viewerUid) return true;
  return isStaff(viewerRole);
}

function canEditMessage(message, viewerUid) {
  // Per spec: only the original sender may edit — staff cannot edit others' messages.
  return message.senderId === viewerUid;
}

// Role permission matrix helpers (mirrors the spec table)
function canBroadcast(role) { return isAdminOrOwner(role); }
function canSearchUsers(role) { return isStaff(role); }
function canGrantAdmin(role) { return role === "owner"; }
function canGrantHelper(role) { return role === "owner"; }
function canRevokeStaffRoles(role) { return role === "owner"; }
function canBlockUsers(role) { return isAdminOrOwner(role); }
function canUnblockUsers(role) { return isAdminOrOwner(role); }
function canRequestBlock(role) { return role === "helper"; }
function canViewBlockRequests(role) { return isAdminOrOwner(role); }
function canMuteUsers(role) { return isStaff(role); }
function canWipeAccounts(role) { return role === "owner"; }

// ============================================================
// CHANNEL RENDERING & SWITCHING
// ============================================================

function renderChannelList() {
  clearChildren(el.channelList);
  const role = state.currentUser.role;
  for (const channel of CHANNELS) {
    if (!canAccessChannel(channel, role)) continue;
    const btn = makeEl("button", {
      className: "channel-btn" + (channel === state.currentChannel ? " active" : ""),
      attrs: { type: "button", "aria-label": `#${channel} channel` },
      onClick: () => switchChannel(channel),
    });
    btn.appendChild(makeEl("span", { className: "channel-hash", text: "#" }));
    btn.appendChild(textNode(channel));
    btn.dataset.channel = channel;
    el.channelList.appendChild(btn);
  }
}

function switchChannel(channel) {
  if (!canAccessChannel(channel, state.currentUser.role)) {
    channel = "general";
  }

  // Detach previous channel's listener to avoid duplicates / leaks.
  const prev = state.messageListeners[state.currentChannel];
  if (prev) {
    try { prev(); } catch (e) { /* ignore */ }
    delete state.messageListeners[state.currentChannel];
  }

  state.currentChannel = channel;
  saveLastChannel(channel);
  state.replyTarget = null;
  updateReplyPreviewUI();

  // Update sidebar highlight
  el.channelList.querySelectorAll(".channel-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.channel === channel);
  });

  el.channelNameDisplay.textContent = `#${channel}`;
  el.messageInput.placeholder = `Message #${channel}`;
  clearChildren(el.messagesList);
  el.emptyChannelState.classList.add("hidden");
  state.isNearBottom = true;

  attachMessageListener(channel);
}

// ============================================================
// MESSAGE LISTENING & RENDERING
// ============================================================

function attachMessageListener(channel) {
  const channelRef = ref(db, `messages/${channel}`);
  const handler = (snapshot) => {
    const data = snapshot.val() || {};
    const entries = Object.entries(data).sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));

    clearChildren(el.messagesList);
    el.emptyChannelState.classList.toggle("hidden", entries.length > 0);

    for (const [msgId, msg] of entries) {
      renderMessage(msgId, msg);
    }
    maybeAutoScroll();
  };
  onValue(channelRef, handler);
  state.messageListeners[channel] = () => off(channelRef, "value", handler);
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today at ${timeStr}`;
  const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${dateStr} ${timeStr}`;
}

function renderMessage(msgId, msg) {
  const row = makeEl("div", { className: "message-row" });
  row.dataset.msgId = msgId;

  if (msg.replyToAuthorId === state.currentUid && msg.senderId !== state.currentUid) {
    row.classList.add("highlighted-reply");
  }

  const avatarImg = document.createElement("img");
  avatarImg.className = "avatar";
  avatarImg.alt = `${msg.senderDisplayName || msg.senderUsername}'s avatar`;
  avatarImg.src = safeAvatarSrc(msg.senderProfilePicture);
  avatarImg.addEventListener("click", () => openUserProfileById(msg.senderId));
  row.appendChild(avatarImg);

  const body = makeEl("div", { className: "message-body" });

  if (msg.replyToId) {
    const replyLine = makeEl("div", { className: "reply-context" });
    replyLine.appendChild(textNode(`↪ ${msg.replyToAuthorName || "someone"}: `));
    replyLine.appendChild(makeEl("span", { text: msg.replyToSnippet || "" }));
    body.appendChild(replyLine);
  }

  const meta = makeEl("div", { className: "message-meta" });
  const authorSpan = makeEl("span", {
    className: "message-author",
    text: msg.senderDisplayName || msg.senderUsername,
    onClick: () => openUserProfileById(msg.senderId),
  });
  meta.appendChild(authorSpan);
  meta.appendChild(makeEl("span", { className: "message-time", text: formatTimestamp(msg.timestamp) }));
  if (msg.edited) meta.appendChild(makeEl("span", { className: "message-edited", text: "(edited)" }));
  body.appendChild(meta);

  const textDiv = makeEl("div", { className: "message-text", text: msg.text || "" });
  body.appendChild(textDiv);

  if (msg.attachment) {
    body.appendChild(renderAttachment(msg.attachment));
  }

  row.appendChild(body);

  // Hover action menu
  const actions = makeEl("div", { className: "message-actions" });
  const role = state.currentUser.role;

  actions.appendChild(makeEl("button", {
    className: "icon-btn", attrs: { type: "button", "aria-label": "Reply", title: "Reply" },
    text: "Reply",
    onClick: () => startReply(msgId, msg),
  }));

  if (canEditMessage(msg, state.currentUid) && !msg.attachment) {
    actions.appendChild(makeEl("button", {
      className: "icon-btn", attrs: { type: "button", "aria-label": "Edit", title: "Edit" },
      text: "Edit",
      onClick: () => startEdit(msgId, msg, row),
    }));
  }

  if (canDeleteMessage(msg, state.currentUid, role)) {
    actions.appendChild(makeEl("button", {
      className: "icon-btn", attrs: { type: "button", "aria-label": "Delete", title: "Delete" },
      text: "Delete",
      onClick: () => confirmDeleteMessage(msgId),
    }));
  }

  row.appendChild(actions);
  el.messagesList.appendChild(row);
}

function renderAttachment(att) {
  const wrap = document.createElement("div");
  const dataUrl = `data:${att.mimeType};base64,${att.base64}`;

  if (att.mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.className = "attachment-image";
    img.src = dataUrl;
    img.alt = att.filename || "Uploaded image";
    img.addEventListener("click", () => window.open(dataUrl, "_blank"));
    wrap.appendChild(img);
    return wrap;
  }

  if (att.mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.className = "attachment-video";
    video.src = dataUrl;
    video.controls = true;
    wrap.appendChild(video);
    return wrap;
  }

  if (att.mimeType.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.className = "attachment-audio";
    audio.src = dataUrl;
    audio.controls = true;
    wrap.appendChild(audio);
    return wrap;
  }

  if (att.mimeType === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.className = "attachment-pdf";
    iframe.src = dataUrl;
    iframe.title = att.filename || "PDF attachment";
    wrap.appendChild(iframe);
    return wrap;
  }

  // Generic / unsupported file — filename, metadata, download button. No auto-download.
  const card = makeEl("div", { className: "attachment-file" });
  card.appendChild(makeEl("div", { className: "attachment-file-icon", text: "📄" }));
  const info = makeEl("div", { className: "attachment-file-info" });
  info.appendChild(makeEl("div", { className: "attachment-file-name", text: att.filename || "file" }));
  info.appendChild(makeEl("div", {
    className: "attachment-file-meta",
    text: `${att.mimeType || "unknown type"} · ${formatBytes(att.size || 0)}`,
  }));
  card.appendChild(info);
  card.appendChild(makeEl("button", {
    className: "icon-btn", attrs: { type: "button", "aria-label": "Download file", title: "Download" },
    text: "Download",
    onClick: () => downloadBase64File(att),
  }));
  wrap.appendChild(card);
  return wrap;
}

function downloadBase64File(att) {
  try {
    const byteChars = atob(att.base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: att.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    console.error(e);
    showToast("Could not reconstruct the file for download.", "error");
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------- Auto-scroll ----------------

el.messagesScroll.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = el.messagesScroll;
  state.isNearBottom = scrollHeight - (scrollTop + clientHeight) < 120;
  el.newMessagesBtn.classList.toggle("hidden", state.isNearBottom);
});

function maybeAutoScroll() {
  if (state.isNearBottom) {
    el.messagesScroll.scrollTop = el.messagesScroll.scrollHeight;
    el.newMessagesBtn.classList.add("hidden");
  } else {
    el.newMessagesBtn.classList.remove("hidden");
  }
}

el.newMessagesBtn.addEventListener("click", () => {
  el.messagesScroll.scrollTop = el.messagesScroll.scrollHeight;
  el.newMessagesBtn.classList.add("hidden");
  state.isNearBottom = true;
});

// ============================================================
// SENDING MESSAGES
// ============================================================

async function sendMessage() {
  const text = el.messageInput.value.trim();
  const hasFile = !!state.pendingFile;

  if (!text && !hasFile) return;
  if (text.length > MAX_MSG_LEN) {
    showToast(`Messages are limited to ${MAX_MSG_LEN} characters.`, "error");
    return;
  }
  if (isCurrentlyMuted()) {
    showToast("You're muted and can't send messages right now.", "error");
    return;
  }

  const user = state.currentUser;
  const msgRef = push(ref(db, `messages/${state.currentChannel}`));

  const payload = {
    senderId: state.currentUid,
    senderUsername: user.username,
    senderDisplayName: user.displayName || user.username,
    senderProfilePicture: user.profilePicture || null,
    channel: state.currentChannel,
    text,
    timestamp: Date.now(), // client timestamp for ordering; also store server time below
    serverTime: serverTimestamp(),
    edited: false,
  };

  if (state.replyTarget) {
    payload.replyToId = state.replyTarget.id;
    payload.replyToAuthorId = state.replyTarget.authorId;
    payload.replyToAuthorName = state.replyTarget.authorName;
    payload.replyToSnippet = state.replyTarget.snippet;
  }

  if (hasFile) {
    payload.attachment = {
      filename: state.pendingFile.name,
      mimeType: state.pendingFile.type || "application/octet-stream",
      size: state.pendingFile.size,
      base64: state.pendingFile.base64,
      uploadedAt: Date.now(),
    };
  }

  try {
    await set(msgRef, payload);
    el.messageInput.value = "";
    autoResizeTextarea();
    clearReply();
    clearPendingFile();
  } catch (e) {
    console.error(e);
    showToast("Failed to send message. Please try again.", "error");
  }
}

el.sendBtn.addEventListener("click", sendMessage);
el.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
el.messageInput.addEventListener("input", autoResizeTextarea);
function autoResizeTextarea() {
  el.messageInput.style.height = "auto";
  el.messageInput.style.height = Math.min(el.messageInput.scrollHeight, 160) + "px";
}

// ============================================================
// REPLIES
// ============================================================

function startReply(msgId, msg) {
  const authorName = msg.senderDisplayName || msg.senderUsername;
  const snippet = (msg.text || (msg.attachment ? `[${msg.attachment.filename}]` : "")).slice(0, 80);
  state.replyTarget = {
    id: msgId,
    authorId: msg.senderId,
    authorName,
    snippet: snippet.length === 80 ? snippet + "…" : snippet,
  };
  updateReplyPreviewUI();
  el.messageInput.focus();
}

function clearReply() {
  state.replyTarget = null;
  updateReplyPreviewUI();
}

function updateReplyPreviewUI() {
  if (!state.replyTarget) {
    el.replyPreview.classList.add("hidden");
    return;
  }
  el.replyPreview.classList.remove("hidden");
  el.replyPreviewName.textContent = state.replyTarget.authorName;
  el.replyPreviewSnippet.textContent = state.replyTarget.snippet;
}

el.cancelReplyBtn.addEventListener("click", clearReply);

// ============================================================
// EDITING MESSAGES
// ============================================================

function startEdit(msgId, msg, rowEl) {
  const textDiv = rowEl.querySelector(".message-text");
  if (!textDiv) return;

  const originalText = msg.text || "";
  const textarea = document.createElement("textarea");
  textarea.className = "field-input";
  textarea.value = originalText;
  textarea.maxLength = MAX_MSG_LEN;
  textarea.rows = 2;

  const controls = makeEl("div", { className: "reply-preview", attrs: { style: "margin:6px 0 0 0;" } });
  const saveBtn = makeEl("button", { className: "btn btn-primary", text: "Save", attrs: { style: "padding:5px 12px;font-size:12px;" } });
  const cancelBtn = makeEl("button", { className: "btn btn-secondary", text: "Cancel", attrs: { style: "padding:5px 12px;font-size:12px;margin-left:6px;" } });
  controls.appendChild(saveBtn);
  controls.appendChild(cancelBtn);

  clearChildren(textDiv);
  textDiv.appendChild(textarea);
  textDiv.appendChild(controls);
  textarea.focus();

  const finishEdit = async (save) => {
    if (save) {
      const newText = textarea.value.trim();
      if (!newText) { showToast("Message can't be empty.", "error"); return; }
      if (newText.length > MAX_MSG_LEN) { showToast(`Limit is ${MAX_MSG_LEN} characters.`, "error"); return; }
      try {
        await update(ref(db, `messages/${state.currentChannel}/${msgId}`), {
          text: newText,
          edited: true,
        });
      } catch (e) {
        console.error(e);
        showToast("Failed to save edit.", "error");
      }
    }
    // Listener will re-render the message list with fresh data either way.
  };

  saveBtn.addEventListener("click", () => finishEdit(true));
  cancelBtn.addEventListener("click", () => finishEdit(false));
}

// ============================================================
// DELETING MESSAGES
// ============================================================

function confirmDeleteMessage(msgId) {
  askConfirm("Delete message?", "This can't be undone.", async () => {
    try {
      await remove(ref(db, `messages/${state.currentChannel}/${msgId}`));
    } catch (e) {
      console.error(e);
      showToast("Failed to delete message.", "error");
    }
  });
}

// ============================================================
// FILE UPLOADS (Base64 into Realtime Database — no Storage)
// ============================================================

el.fileUploadBtn.addEventListener("click", () => el.fileInput.click());

el.fileInput.addEventListener("change", async () => {
  const file = el.fileInput.files[0];
  el.fileInput.value = "";
  if (!file) return;

  if (file.size > MAX_FILE_BYTES) {
    showToast(`File too large. Max size is ${formatBytes(MAX_FILE_BYTES)}.`, "error");
    return;
  }

  try {
    const base64 = await fileToBase64(file);
    // Base64 expands size ~33%; sanity-check the encoded length too.
    const approxEncodedBytes = base64.length * 0.75;
    if (approxEncodedBytes > MAX_FILE_BYTES * 1.4) {
      showToast("File is too large once encoded for storage.", "error");
      return;
    }

    state.pendingFile = { name: file.name, type: file.type, size: file.size, base64 };
    renderFilePreview();
  } catch (e) {
    console.error(e);
    showToast("Could not read that file.", "error");
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // "data:<mime>;base64,<data>"
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderFilePreview() {
  if (!state.pendingFile) {
    el.filePreview.classList.add("hidden");
    clearChildren(el.filePreview);
    return;
  }
  clearChildren(el.filePreview);
  el.filePreview.classList.remove("hidden");
  el.filePreview.appendChild(makeEl("span", {
    text: `${state.pendingFile.name} (${formatBytes(state.pendingFile.size)})`,
  }));
  el.filePreview.appendChild(makeEl("button", {
    className: "icon-btn", attrs: { type: "button", "aria-label": "Remove file" },
    text: "Remove",
    onClick: clearPendingFile,
  }));
}

function clearPendingFile() {
  state.pendingFile = null;
  renderFilePreview();
}

// ============================================================
// USER PANEL / PROFILE RENDERING
// ============================================================

function renderUserPanel() {
  const user = state.currentUser;
  el.userPanelAvatar.src = safeAvatarSrc(user.profilePicture);
  el.userPanelName.textContent = user.displayName || user.username;
  el.userPanelRole.textContent = user.role !== "user" ? capitalize(user.role) : "";
  el.userPanelRole.style.display = user.role !== "user" ? "block" : "none";
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ---------------- Edit own profile ----------------

el.profileBtn.addEventListener("click", openProfileEditor);

function openProfileEditor() {
  const user = state.currentUser;
  el.profileDisplayName.value = user.displayName || "";
  el.profileBio.value = user.bio || "";
  updateCounters();
  el.profileError.classList.add("hidden");
  openModal("modalProfile");
}

el.profileDisplayName.addEventListener("input", updateCounters);
el.profileBio.addEventListener("input", updateCounters);
function updateCounters() {
  el.dnCounter.textContent = `${el.profileDisplayName.value.length}/${MAX_DISPLAY_NAME_LEN}`;
  el.bioCounter.textContent = `${el.profileBio.value.length}/${MAX_BIO_LEN}`;
}

el.profileSaveBtn.addEventListener("click", async () => {
  const displayName = el.profileDisplayName.value.trim();
  const bio = el.profileBio.value.trim();

  if (displayName.length > MAX_DISPLAY_NAME_LEN) {
    showProfileError(`Display name must be ${MAX_DISPLAY_NAME_LEN} characters or fewer.`);
    return;
  }
  if (bio.length > MAX_BIO_LEN) {
    showProfileError(`Bio must be ${MAX_BIO_LEN} characters or fewer.`);
    return;
  }

  try {
    await update(ref(db, `users/${state.currentUid}`), { displayName, bio });
    state.currentUser.displayName = displayName;
    state.currentUser.bio = bio;
    renderUserPanel();
    closeModals();
    showToast("Profile updated.", "success");
  } catch (e) {
    console.error(e);
    showProfileError("Failed to save profile. Please try again.");
  }
});

function showProfileError(msg) {
  el.profileError.textContent = msg;
  el.profileError.classList.remove("hidden");
}

// ---------------- View another user's profile ----------------

async function openUserProfileById(uid) {
  if (!uid) return;
  try {
    let record = state.usersCache[uid];
    if (!record) {
      const snap = await get(ref(db, `users/${uid}`));
      if (!snap.exists()) { showToast("User not found.", "error"); return; }
      record = snap.val();
      state.usersCache[uid] = record;
    }
    el.vpAvatar.src = safeAvatarSrc(record.profilePicture);
    el.vpDisplayName.textContent = record.displayName || record.username;
    el.vpUsername.textContent = `@${record.username}`;
    el.vpRole.textContent = record.role !== "user" ? capitalize(record.role) : "";
    el.vpRole.style.display = record.role !== "user" ? "block" : "none";
    el.vpBio.textContent = record.bio || "";
    openModal("modalViewProfile");
  } catch (e) {
    console.error(e);
    showToast("Could not load that profile.", "error");
  }
}

// ---------------- Profile picture upload (with client-side resize) ----------------

el.userPanelAvatarBtn.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.", "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(`Image too large. Max size is ${formatBytes(MAX_FILE_BYTES)}.`, "error");
      return;
    }
    try {
      const resizedBase64 = await resizeImageToBase64(file, MAX_AVATAR_DIMENSION);
      await update(ref(db, `users/${state.currentUid}`), { profilePicture: resizedBase64 });
      state.currentUser.profilePicture = resizedBase64;
      renderUserPanel();
      showToast("Profile picture updated.", "success");
    } catch (e) {
      console.error(e);
      showToast("Failed to update profile picture.", "error");
    }
  });
  input.click();
});

function resizeImageToBase64(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
// REAL-TIME SELF-WATCHERS (block / mute / role)
// ============================================================

function watchOwnBlockStatus(uid) {
  const r = ref(db, `users/${uid}/blocked`);
  const handler = (snap) => {
    const blocked = !!snap.val();
    if (blocked) {
      teardownAllListeners();
      // Keep just the block watcher alive so we notice an unblock.
      watchOwnBlockStatus(uid);
      showBlockedScreen();
    } else if (state.currentUser && el.blockedScreen.classList.contains("hidden") === false) {
      // Was on the blocked screen and is now unblocked — restore access.
      get(ref(db, `users/${uid}`)).then((userSnap) => {
        if (userSnap.exists()) enterApp(uid, userSnap.val());
      });
    }
  };
  onValue(r, handler);
  state.userListeners.push(() => off(r, "value", handler));
}

function watchOwnMuteStatus(uid) {
  const r = ref(db, `users/${uid}/mutedUntil`);
  const handler = (snap) => {
    const mutedUntil = snap.val() || 0;
    state.currentUser.mutedUntil = mutedUntil;
    updateMuteUI();
  };
  onValue(r, handler);
  state.userListeners.push(() => off(r, "value", handler));

  if (state.muteTimer) clearInterval(state.muteTimer);
  state.muteTimer = setInterval(updateMuteUI, 1000);
}

function isCurrentlyMuted() {
  const mutedUntil = state.currentUser?.mutedUntil || 0;
  return mutedUntil > Date.now();
}

function updateMuteUI() {
  if (!state.currentUser) return;
  const muted = isCurrentlyMuted();
  el.muteNotice.classList.toggle("hidden", !muted);
  el.sendBtn.disabled = muted;
  el.messageInput.disabled = muted;
  if (muted) {
    const remainingSec = Math.max(0, Math.ceil((state.currentUser.mutedUntil - Date.now()) / 1000));
    const mm = Math.floor(remainingSec / 60);
    const ss = remainingSec % 60;
    el.muteRemaining.textContent = ` (${mm}:${String(ss).padStart(2, "0")} remaining)`;
  } else {
    el.muteRemaining.textContent = "";
  }
}

function watchOwnRoleChanges(uid) {
  const r = ref(db, `users/${uid}/role`);
  const handler = (snap) => {
    const newRole = snap.val();
    if (!newRole || newRole === state.currentUser.role) return;
    state.currentUser.role = newRole;
    renderUserPanel();
    renderChannelList();
    setupStaffControls();
    if (state.currentChannel === "staff" && !isStaff(newRole)) {
      switchChannel("general");
    }
    if (isStaff(newRole)) watchBlockRequestsDot();
    showToast(`Your role is now ${capitalize(newRole)}.`, "info");
  };
  onValue(r, handler);
  state.userListeners.push(() => off(r, "value", handler));
}

// ============================================================
// STAFF CONTROLS ENTRY POINT
// ============================================================

function setupStaffControls() {
  clearChildren(el.staffControls);
  const role = state.currentUser.role;
  if (!isStaff(role)) return;

  const btn = makeEl("button", {
    className: "icon-btn", attrs: { type: "button", "aria-label": "Staff menu", title: "Staff menu" },
    text: "Staff",
    onClick: openStaffMenu,
  });
  el.staffControls.appendChild(btn);
}

function openStaffMenu() {
  const role = state.currentUser.role;
  el.staffBroadcastBtn.classList.toggle("hidden", !canBroadcast(role));
  el.staffUsermanagerBtn.classList.toggle("hidden", !canSearchUsers(role));
  el.staffBlockrequestsBtn.classList.toggle("hidden", !canViewBlockRequests(role));
  openModal("modalStaffMenu");
}

el.staffBroadcastBtn.addEventListener("click", () => {
  el.broadcastMessage.value = "";
  el.broadcastDuration.value = "8";
  el.broadcastCounter.textContent = `0/${MAX_BROADCAST_LEN}`;
  el.broadcastError.classList.add("hidden");
  openModal("modalBroadcast");
});
el.staffUsermanagerBtn.addEventListener("click", () => {
  el.userSearchInput.value = "";
  clearChildren(el.userSearchResults);
  openModal("modalUsermanager");
  loadAllUsersIfNeeded().then(() => renderUserSearchResults(""));
});
el.staffBlockrequestsBtn.addEventListener("click", () => {
  openModal("modalBlockRequests");
  loadBlockRequestsList();
});

// ============================================================
// BROADCAST SYSTEM
// ============================================================

el.broadcastMessage.addEventListener("input", () => {
  el.broadcastCounter.textContent = `${el.broadcastMessage.value.length}/${MAX_BROADCAST_LEN}`;
});

el.broadcastSendBtn.addEventListener("click", async () => {
  const message = el.broadcastMessage.value.trim();
  const duration = parseInt(el.broadcastDuration.value, 10);

  if (!message) return showBroadcastError("Broadcast message can't be empty.");
  if (message.length > MAX_BROADCAST_LEN) return showBroadcastError(`Limit is ${MAX_BROADCAST_LEN} characters.`);
  if (!canBroadcast(state.currentUser.role)) return showBroadcastError("You don't have permission to broadcast.");
  if (isNaN(duration) || duration < MIN_BROADCAST_SEC || duration > MAX_BROADCAST_SEC) {
    return showBroadcastError(`Duration must be between ${MIN_BROADCAST_SEC} and ${MAX_BROADCAST_SEC} seconds.`);
  }

  const now = Date.now();
  const expiresAt = now + duration * 1000;

  try {
    await set(ref(db, "broadcast/current"), {
      message,
      createdBy: state.currentUser.username,
      startedAt: now,
      expiresAt,
    });
    closeModals();
    showToast("Broadcast sent.", "success");
  } catch (e) {
    console.error(e);
    showBroadcastError("Failed to send broadcast.");
  }
});

function showBroadcastError(msg) {
  el.broadcastError.textContent = msg;
  el.broadcastError.classList.remove("hidden");
}

function watchBroadcast() {
  const r = ref(db, "broadcast/current");
  const handler = (snap) => {
    const data = snap.val();
    if (state.broadcastTimer) clearTimeout(state.broadcastTimer);

    if (!data || !data.expiresAt || data.expiresAt <= Date.now()) {
      el.broadcastBanner.classList.add("hidden");
      return;
    }

    el.broadcastText.textContent = data.message;
    el.broadcastBanner.classList.remove("hidden");

    const remaining = data.expiresAt - Date.now();
    state.broadcastTimer = setTimeout(() => {
      el.broadcastBanner.classList.add("hidden");
    }, remaining);
  };
  onValue(r, handler);
  state.userListeners.push(() => off(r, "value", handler));
}

// ============================================================
// USER MANAGER (search)
// ============================================================

async function loadAllUsersIfNeeded() {
  if (state.allUsersLoaded) return;
  const snap = await get(ref(db, "users"));
  const data = snap.val() || {};
  for (const [uid, record] of Object.entries(data)) {
    state.usersCache[uid] = record;
  }
  state.allUsersLoaded = true;
}

el.userSearchInput.addEventListener("input", () => {
  renderUserSearchResults(el.userSearchInput.value.trim().toLowerCase());
});

function renderUserSearchResults(query) {
  clearChildren(el.userSearchResults);
  const entries = Object.entries(state.usersCache)
    .filter(([uid]) => uid !== state.currentUid)
    .filter(([, rec]) => !query || rec.username.toLowerCase().includes(query))
    .sort((a, b) => a[1].username.localeCompare(b[1].username))
    .slice(0, 50);

  if (entries.length === 0) {
    el.userSearchResults.appendChild(makeEl("div", { className: "empty-state", text: "No users found." }));
    return;
  }

  for (const [uid, record] of entries) {
    const row = makeEl("div", {
      className: "user-result-row",
      onClick: () => openManageUser(uid, record),
    });
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = safeAvatarSrc(record.profilePicture);
    avatar.alt = "";
    row.appendChild(avatar);

    const info = makeEl("div", { className: "user-result-info" });
    info.appendChild(makeEl("div", { className: "user-result-name", text: record.displayName || record.username }));
    info.appendChild(makeEl("div", {
      className: "user-result-sub",
      text: `@${record.username}${record.role !== "user" ? " · " + capitalize(record.role) : ""}`,
    }));
    row.appendChild(info);
    el.userSearchResults.appendChild(row);
  }
}

// ============================================================
// MANAGE USER PANEL — role-gated action buttons
// ============================================================

function openManageUser(uid, record) {
  state.activeManagedUid = uid;
  el.muAvatar.src = safeAvatarSrc(record.profilePicture);
  el.muDisplayName.textContent = record.displayName || record.username;
  el.muUsername.textContent = `@${record.username}${record.role !== "user" ? " · " + capitalize(record.role) : ""}`;

  clearChildren(el.muActions);
  const viewerRole = state.currentUser.role;
  const targetIsOwner = record.role === "owner";

  const addAction = (label, className, onClick) => {
    el.muActions.appendChild(makeEl("button", { className: `btn ${className} btn-block`, text: label, onClick }));
  };

  if (targetIsOwner) {
    el.muActions.appendChild(makeEl("p", {
      className: "user-result-sub",
      text: "The Owner account can't be modified.",
    }));
    openModal("modalManageUser");
    return;
  }

  // ---- Owner-only: role granting/revoking ----
  if (canGrantAdmin(viewerRole) && record.role !== "admin") {
    addAction("Grant Admin", "btn-secondary", () => setUserRole(uid, "admin"));
  }
  if (canGrantHelper(viewerRole) && record.role !== "helper") {
    addAction("Grant Helper", "btn-secondary", () => setUserRole(uid, "helper"));
  }
  if (canRevokeStaffRoles(viewerRole) && isStaff(record.role)) {
    addAction("Revoke Staff Role", "btn-secondary", () => setUserRole(uid, "user"));
  }

  // ---- Owner/Admin: block/unblock ----
  if (canBlockUsers(viewerRole) && !record.blocked) {
    addAction("Block From Site", "btn-danger", () => confirmBlockUser(uid, record));
  }
  if (canUnblockUsers(viewerRole) && record.blocked) {
    addAction("Unblock From Site", "btn-secondary", () => setUserBlocked(uid, false));
  }

  // ---- Owner/Admin/Helper: mute ----
  if (canMuteUsers(viewerRole)) {
    addAction("Mute 30s", "btn-secondary", () => muteUser(uid, 30));
    addAction("Mute 2 min", "btn-secondary", () => muteUser(uid, 120));
    addAction("Mute 10 min", "btn-secondary", () => muteUser(uid, 600));
  }

  // ---- Helper: request block ----
  if (canRequestBlock(viewerRole)) {
    addAction("Request to Block", "btn-danger", () => openBlockReasonModal(uid, record));
  }

  // ---- Owner only: wipe account ----
  if (canWipeAccounts(viewerRole)) {
    addAction("Wipe Account", "btn-danger", () => confirmWipeAccount(uid, record));
  }

  if (el.muActions.children.length === 0) {
    el.muActions.appendChild(makeEl("p", { className: "user-result-sub", text: "No actions available." }));
  }

  openModal("modalManageUser");
}

async function setUserRole(uid, role) {
  try {
    await update(ref(db, `users/${uid}`), { role });
    if (state.usersCache[uid]) state.usersCache[uid].role = role;
    closeModals();
    showToast(`Role updated to ${capitalize(role)}.`, "success");
  } catch (e) {
    console.error(e);
    showToast("Failed to update role.", "error");
  }
}

function confirmBlockUser(uid, record) {
  askConfirm(
    "Block this user?",
    `${record.username} will lose access to the chat until unblocked.`,
    () => setUserBlocked(uid, true)
  );
}

async function setUserBlocked(uid, blocked) {
  try {
    await update(ref(db, `users/${uid}`), { blocked });
    if (state.usersCache[uid]) state.usersCache[uid].blocked = blocked;
    closeModals();
    showToast(blocked ? "User blocked." : "User unblocked.", "success");
  } catch (e) {
    console.error(e);
    showToast("Failed to update block status.", "error");
  }
}

async function muteUser(uid, seconds) {
  const clamped = Math.min(Math.max(seconds, MIN_MUTE_SEC), MAX_MUTE_SEC);
  const mutedUntil = Date.now() + clamped * 1000;
  try {
    await update(ref(db, `users/${uid}`), { mutedUntil });
    closeModals();
    showToast(`User muted for ${clamped}s.`, "success");
  } catch (e) {
    console.error(e);
    showToast("Failed to mute user.", "error");
  }
}

function confirmWipeAccount(uid, record) {
  askConfirm(
    "Wipe this account?",
    `This resets ${record.username}'s profile picture, display name, bio, and assigns a new random username. This can't be undone.`,
    () => wipeAccount(uid, record)
  );
}

async function wipeAccount(uid, record) {
  try {
    const newUsername = await generateUniqueWipedUsername();
    const newNormalized = normalizeUsername(newUsername);
    const oldNormalized = record.normalizedUsername;

    const updates = {};
    updates[`users/${uid}/username`] = newUsername;
    updates[`users/${uid}/normalizedUsername`] = newNormalized;
    updates[`users/${uid}/displayName`] = "";
    updates[`users/${uid}/bio`] = "";
    updates[`users/${uid}/profilePicture`] = null;
    updates[`usernames/${newNormalized}`] = uid;
    updates[`usernames/${oldNormalized}`] = null; // release old username

    await update(ref(db), updates);

    if (state.usersCache[uid]) {
      Object.assign(state.usersCache[uid], {
        username: newUsername, normalizedUsername: newNormalized,
        displayName: "", bio: "", profilePicture: null,
      });
    }
    closeModals();
    showToast("Account wiped.", "success");
  } catch (e) {
    console.error(e);
    showToast("Failed to wipe account.", "error");
  }
}

// ============================================================
// BLOCK REQUESTS (Helper submits, Owner/Admin review)
// ============================================================

function openBlockReasonModal(uid, record) {
  state.activeManagedUid = uid;
  el.blockReasonInput.value = "";
  el.reasonCounter.textContent = `0/${MAX_REASON_LEN}`;
  el.blockReasonError.classList.add("hidden");
  openModal("modalBlockReason");
}

el.blockReasonInput.addEventListener("input", () => {
  el.reasonCounter.textContent = `${el.blockReasonInput.value.length}/${MAX_REASON_LEN}`;
});

el.blockReasonSubmit.addEventListener("click", async () => {
  const reason = el.blockReasonInput.value.trim();
  if (!reason) {
    el.blockReasonError.textContent = "Please enter a reason.";
    el.blockReasonError.classList.remove("hidden");
    return;
  }
  if (reason.length > MAX_REASON_LEN) {
    el.blockReasonError.textContent = `Limit is ${MAX_REASON_LEN} characters.`;
    el.blockReasonError.classList.remove("hidden");
    return;
  }

  const targetUid = state.activeManagedUid;
  const targetRecord = state.usersCache[targetUid];

  try {
    const reqRef = push(ref(db, "blockRequests"));
    await set(reqRef, {
      targetUserId: targetUid,
      targetUsername: targetRecord?.username || "",
      targetDisplayName: targetRecord?.displayName || "",
      requestedBy: state.currentUser.username,
      reason,
      createdAt: Date.now(),
    });
    closeModals();
    showToast("Block request submitted.", "success");
  } catch (e) {
    console.error(e);
    el.blockReasonError.textContent = "Failed to submit request.";
    el.blockReasonError.classList.remove("hidden");
  }
});

async function loadBlockRequestsList() {
  clearChildren(el.blockRequestsList);
  try {
    const snap = await get(ref(db, "blockRequests"));
    const data = snap.val() || {};
    const entries = Object.entries(data).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

    el.blockRequestsEmpty.classList.toggle("hidden", entries.length > 0);

    for (const [reqId, reqData] of entries) {
      el.blockRequestsList.appendChild(renderBlockRequestCard(reqId, reqData));
    }
  } catch (e) {
    console.error(e);
    showToast("Failed to load block requests.", "error");
  }
}

function renderBlockRequestCard(reqId, reqData) {
  const card = makeEl("div", { className: "block-request-card" });
  card.appendChild(makeEl("div", {
    className: "br-target",
    text: `Target: ${reqData.targetDisplayName || reqData.targetUsername} (@${reqData.targetUsername})`,
  }));
  card.appendChild(makeEl("div", {
    className: "br-meta",
    text: `Requested by ${reqData.requestedBy} · ${formatTimestamp(reqData.createdAt)}`,
  }));
  card.appendChild(makeEl("div", { className: "br-reason", text: reqData.reason }));

  const actions = makeEl("div", { className: "br-actions" });
  actions.appendChild(makeEl("button", {
    className: "btn btn-primary", text: "Accept",
    onClick: () => resolveBlockRequest(reqId, reqData, true),
  }));
  actions.appendChild(makeEl("button", {
    className: "btn btn-secondary", text: "Deny",
    onClick: () => resolveBlockRequest(reqId, reqData, false),
  }));
  card.appendChild(actions);
  return card;
}

async function resolveBlockRequest(reqId, reqData, accept) {
  try {
    if (accept) {
      await update(ref(db, `users/${reqData.targetUserId}`), { blocked: true });
    }
    await remove(ref(db, `blockRequests/${reqId}`));
    showToast(accept ? "User blocked." : "Request denied.", "success");
    loadBlockRequestsList();
  } catch (e) {
    console.error(e);
    showToast("Failed to process request.", "error");
  }
}

function watchBlockRequestsDot() {
  const r = ref(db, "blockRequests");
  const handler = (snap) => {
    const hasAny = snap.exists() && Object.keys(snap.val() || {}).length > 0;
    const canSee = canViewBlockRequests(state.currentUser.role);
    el.blockRequestsDot.classList.toggle("hidden", !(hasAny && canSee));
  };
  onValue(r, handler);
  state.userListeners.push(() => off(r, "value", handler));
}

// ============================================================
// AUTH SCREEN UI (login / create account toggle + submission)
// ============================================================

let authMode = "login"; // "login" | "signup"

function resetAuthForm() {
  el.authUsername.value = "";
  el.authPassword.value = "";
  el.authError.classList.add("hidden");
  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode;
  el.tabLogin.classList.toggle("active", mode === "login");
  el.tabSignup.classList.toggle("active", mode === "signup");
  el.authSubmitLabel.textContent = mode === "login" ? "Log In" : "Create Account";
  el.authError.classList.add("hidden");
}

el.tabLogin.addEventListener("click", () => setAuthMode("login"));
el.tabSignup.addEventListener("click", () => setAuthMode("signup"));

function showAuthError(msg) {
  el.authError.textContent = msg;
  el.authError.classList.remove("hidden");
}

function setAuthLoading(isLoading) {
  el.authSubmit.disabled = isLoading;
  el.authSubmitSpinner.classList.toggle("hidden", !isLoading);
  el.authSubmitLabel.classList.toggle("hidden", isLoading);
}

el.authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = el.authUsername.value.trim();
  const password = el.authPassword.value;
  el.authError.classList.add("hidden");

  if (!username || !password) {
    showAuthError("Please enter a username and password.");
    return;
  }

  setAuthLoading(true);
  try {
    if (authMode === "signup") {
      if (!isValidUsernameFormat(username)) {
        showAuthError("Username must be 3-16 characters: letters, numbers, underscores only.");
        return;
      }
      const uid = await createAccount(username, password);
      const snap = await get(ref(db, `users/${uid}`));
      enterApp(uid, snap.val());
    } else {
      const { uid, userRecord, blocked } = await loginWithCredentials(username, password);
      if (blocked) {
        state.currentUid = uid;
        state.currentUser = userRecord;
        saveSession(uid);
        showBlockedScreen();
        watchOwnBlockStatus(uid);
      } else {
        enterApp(uid, userRecord);
      }
    }
  } catch (err) {
    showAuthError(err.message || "Something went wrong. Please try again.");
  } finally {
    setAuthLoading(false);
  }
});

// ============================================================
// LOGOUT
// ============================================================

el.logoutBtn.addEventListener("click", logout);
el.blockedLogoutBtn.addEventListener("click", () => {
  teardownAllListeners();
  clearSession();
  state.currentUser = null;
  state.currentUid = null;
  showAuthScreen();
});

// ============================================================
// CONNECTION STATUS
// ============================================================

function watchConnectionStatus() {
  const r = ref(db, ".info/connected");
  onValue(r, (snap) => {
    const connected = snap.val() === true;
    el.statusDot.className = "status-dot " + (connected ? "connected" : "reconnecting");
    el.statusLabel.textContent = connected ? "Connected" : "Reconnecting…";
  });
}

// ============================================================
// MOBILE SIDEBAR TOGGLE
// ============================================================

el.sidebarToggle.addEventListener("click", () => el.sidebar.classList.toggle("open"));
el.mobileSidebarBtn.addEventListener("click", () => el.sidebar.classList.toggle("open"));

// ============================================================
// BOOTSTRAP
// ============================================================

showLoadingScreen();
watchConnectionStatus();
bootstrapSession();
