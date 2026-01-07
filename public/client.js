// PIXELPR client

const socket = io();

const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('message-form');
const inputEl = document.getElementById('message-input');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const nicknameEl = document.getElementById('nickname');
const userCountEl = document.getElementById('user-count');

let myNickname = null;

// utility to format ISO timestamps
function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function appendSystemMessage(text, timestamp, group = '') {
  const wrapper = document.createElement('div');
  wrapper.className = 'system-message';
  // tag system messages with group for view filtering
  wrapper.dataset.group = group || '';

  const span = document.createElement('span');
  const timePart = timestamp ? ` • ${formatTime(timestamp)}` : '';
  span.textContent = `${text}${timePart}`;

  wrapper.appendChild(span);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // apply the current view filter so system messages don't leak into group view
  applyViewFilter();
}

function appendChatMessage({ nickname, text, timestamp }) {
  const wrapper = document.createElement('div');
  const isMe = nickname === myNickname;
  wrapper.className = `message ${isMe ? 'me' : 'other'}`;
  // public message marker for filtering
  wrapper.dataset.group = '';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = isMe ? `${nickname} (you)` : nickname;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const timeEl = document.createElement('div');
  timeEl.className = 'timestamp';
  timeEl.textContent = formatTime(timestamp);

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);
  wrapper.appendChild(timeEl);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  applyViewFilter();
}

function appendVoiceMessage({ nickname, audio, duration, timestamp }) {
  const wrapper = document.createElement("div");
  const isMe = nickname === myNickname;
  wrapper.className = `message ${isMe ? "me" : "other"}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = isMe ? `${nickname} (you)` : nickname;

  const audioEl = document.createElement("audio");
  audioEl.controls = true;

  // audio may arrive as a Blob, a data URL string, a Node-serialized Buffer, ArrayBuffer or a TypedArray
  let audioURL;
  if (typeof audio === 'string') {
    // data URL or hosted URL
    audioURL = audio;
    audioEl.src = audioURL;
  } else if (audio instanceof Blob || (window.Blob && audio && audio.constructor === Blob)) {
    audioURL = URL.createObjectURL(audio);
    audioEl.src = audioURL;
    // revoke object URL when audio is loaded to avoid memory leaks
    audioEl.addEventListener('loadeddata', () => {
      setTimeout(() => URL.revokeObjectURL(audioURL), 3000);
    });
  } else if (audio && audio.type === 'Buffer' && Array.isArray(audio.data)) {
    // Node Buffer serialized over the wire: { type: 'Buffer', data: [...] }
    const arr = new Uint8Array(audio.data);
    const blob = new Blob([arr], { type: 'audio/webm' });
    audioURL = URL.createObjectURL(blob);
    audioEl.src = audioURL;
    audioEl.addEventListener('loadeddata', () => {
      setTimeout(() => URL.revokeObjectURL(audioURL), 3000);
    });
  } else if (audio instanceof ArrayBuffer) {
    const blob = new Blob([audio], { type: 'audio/webm' });
    audioURL = URL.createObjectURL(blob);
    audioEl.src = audioURL;
    audioEl.addEventListener('loadeddata', () => {
      setTimeout(() => URL.revokeObjectURL(audioURL), 3000);
    });
  } else if (audio && audio.buffer && audio.buffer instanceof ArrayBuffer) {
    // TypedArray (e.g., Uint8Array)
    const blob = new Blob([audio], { type: 'audio/webm' });
    audioURL = URL.createObjectURL(blob);
    audioEl.src = audioURL;
    audioEl.addEventListener('loadeddata', () => {
      setTimeout(() => URL.revokeObjectURL(audioURL), 3000);
    });
  } else {
    audioEl.textContent = 'Audio unavailable';
  }

  const timeEl = document.createElement("div");
  timeEl.className = "timestamp";
  timeEl.textContent = `${formatTime(timestamp)} • ${formatDuration(duration)}`;

  wrapper.appendChild(meta);
  wrapper.appendChild(audioEl);
  wrapper.appendChild(timeEl);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
socket.on("voice_message", payload => {
  appendVoiceMessage(payload);
});
// socket events

socket.on('welcome', ({ nickname, message }) => {
  myNickname = nickname;
  nicknameEl.textContent = `You are ${nickname}`;
  appendSystemMessage(message);
});

socket.on('system_message', payload => {
  appendSystemMessage(payload.message, payload.timestamp, payload.group);
});

socket.on('chat_message', payload => {
  appendChatMessage(payload);
});

socket.on('user_count', count => {
  if (!userCountEl) return;
  userCountEl.textContent = `${count} user${count === 1 ? '' : 's'} online`;
});

// --- Groups UI & logic ---
const groupsToggle = document.getElementById('groups-toggle');
const groupsPanel = document.getElementById('groups-panel');
const createGroupForm = document.getElementById('create-group-form');
const groupNameInput = document.getElementById('group-name-input');
const groupsListEl = document.getElementById('groups-list');
const messageTargetEl = document.getElementById('message-target');

let availableGroups = [];
let myGroups = new Set();
let createdGroups = new Set();
let viewSelectEl = document.getElementById('view-select');
let viewBannerEl = document.getElementById('view-banner');
let currentView = '';
let currentMode = 'global'; // 'global' or 'groups'
const modeGlobalBtn = document.getElementById('mode-global');
const modeGroupsBtn = document.getElementById('mode-groups');

if (modeGlobalBtn) modeGlobalBtn.addEventListener('click', () => {
  currentMode = 'global';
  modeGlobalBtn.classList.add('mode-active');
  modeGroupsBtn && modeGroupsBtn.classList.remove('mode-active');
  currentView = '';
  if (viewSelectEl) viewSelectEl.value = '';
  applyViewFilter();
});
if (modeGroupsBtn) modeGroupsBtn.addEventListener('click', () => {
  currentMode = 'groups';
  modeGroupsBtn.classList.add('mode-active');
  modeGlobalBtn && modeGlobalBtn.classList.remove('mode-active');
  // ensure we show banner even if no group selected
  applyViewFilter();
});

function updateViewBanner() {
  if (!viewBannerEl) return;
  if (!currentView) {
    viewBannerEl.classList.add('hidden');
    viewBannerEl.textContent = '';
    return;
  }
  const member = myGroups.has(currentView);
  const owner = createdGroups.has(currentView);
  viewBannerEl.classList.remove('hidden');
  viewBannerEl.textContent = `Viewing ${currentView} — ${member ? 'you are in this group' : 'you are not a member'}` + (owner ? ' • (you created this group)' : '');
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function sendFile(file, target) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    appendSystemMessage(`File too large (${Math.round(file.size/1024/1024)}MB). Limit is 10MB.`);
    return;
  }

  const targetGroup = target || (viewSelectEl && viewSelectEl.value) || '';
  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

  // optimistic preview using local File (object URL)
  appendFileMessage({ filename: file.name, mimetype: file.type, data: file, nickname: myNickname || 'You', timestamp: new Date().toISOString(), group: targetGroup, clientId });

  // convert file to data URL before sending so server and other clients receive a string
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    socket.emit('file_message', { filename: file.name, mimetype: file.type, data: dataUrl, group: targetGroup, clientId });
  };
  reader.onerror = () => {
    appendSystemMessage('Failed to read file for upload.');
  };
  reader.readAsDataURL(file);
}

function applyViewFilter() {
  // currentView: '' = public, otherwise group name
  for (const child of Array.from(messagesEl.children)) {
    const msgGroup = child.dataset.group || '';
    if (currentMode === 'groups') {
      // in groups mode: show only group messages if a view is selected, otherwise hide global
      if (currentView === '') {
        // show nothing unless a group is selected
        child.style.display = msgGroup ? 'none' : 'none';
      } else {
        child.style.display = msgGroup === currentView ? '' : 'none';
      }
    } else {
      // global mode: show only public messages
      child.style.display = msgGroup === '' ? '' : 'none';
    }
  }
  updateViewBanner();
}

function appendFileMessage({ filename, mimetype, data, nickname, timestamp, group, clientId }) {
  // handle optimistic update: if clientId matches existing optimistic entry, update it rather than duplicate
  if (clientId) {
    const existing = Array.from(messagesEl.children).find(c => c.dataset.clientId === clientId);
    if (existing) {
      // replace with final content (data may be data URL or remain Blob)
      existing.dataset.group = group || '';
      existing.dataset.clientId = clientId;
      const bubble = existing.querySelector('.bubble');
      if (bubble) bubble.innerHTML = renderFileContentHTML({ filename, mimetype, data });
      const timeEl = existing.querySelector('.timestamp');
      if (timeEl) timeEl.textContent = formatTime(timestamp);
      applyViewFilter();
      return;
    }
  }

  const wrapper = document.createElement('div');
  wrapper.className = `message file`;
  wrapper.dataset.group = group || '';
  if (clientId) wrapper.dataset.clientId = clientId;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = nickname ? `${nickname}${group ? ` @ ${group}` : ''}` : (myNickname || 'You');

  const bubble = document.createElement('div');
  bubble.className = 'bubble file-bubble';
  bubble.innerHTML = renderFileContentHTML({ filename, mimetype, data });

  const timeEl = document.createElement('div');
  timeEl.className = 'timestamp';
  timeEl.textContent = formatTime(timestamp);

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);
  wrapper.appendChild(timeEl);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  applyViewFilter();
}

function dataURLToBlob(dataURL) {
  // converts a data URL (data:[<mime>][;base64],<data>) to a Blob
  const parts = dataURL.split(',');
  const header = parts[0] || '';
  const data = parts[1] || '';
  const isBase64 = header.indexOf(';base64') !== -1;
  const m = header.match(/data:([^;]+);?/) || [];
  const mime = m[1] || 'application/octet-stream';
  if (isBase64) {
    const binary = atob(data);
    const len = binary.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } else {
    // percent-encoded text
    const decoded = decodeURIComponent(data);
    return new Blob([decoded], { type: mime });
  }
}

function renderFileContentHTML({ filename, mimetype, data }) {
  // data can be: data URL string, Blob/File, ArrayBuffer, Node Buffer-serialized
  let src = '';
  let downloadHref = '';

  // keep the original data URL when present so the Download link can use it (better mobile support)
  if (typeof data === 'string') {
    if (data.startsWith('data:')) {
      downloadHref = data; // raw data URL preserved for download
      try {
        const blob = dataURLToBlob(data);
        src = URL.createObjectURL(blob);
      } catch (e) {
        // fallback to using the original string if conversion fails
        src = data;
      }
    } else {
      src = data;
      downloadHref = data;
    }
  } else if (data instanceof Blob || (data && data.constructor && data.constructor.name === 'File')) {
    src = URL.createObjectURL(data);
    downloadHref = src;
    // revoke later? leave it, browsers will reclaim on navigation
  } else if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
    const arr = new Uint8Array(data.data);
    const blob = new Blob([arr], { type: mimetype || 'application/octet-stream' });
    src = URL.createObjectURL(blob);
    downloadHref = src;
  } else if (data instanceof ArrayBuffer) {
    const blob = new Blob([data], { type: mimetype || 'application/octet-stream' });
    src = URL.createObjectURL(blob);
    downloadHref = src;
  }

  const dlHref = downloadHref || src;

  if ((mimetype || '').startsWith('image/')) {
    const img = `<img src="${src}" alt="${filename}" />`;
    const dl = dlHref ? `<div style="margin-top:6px"><a class=\"file-link\" href=\"${dlHref}\" download=\"${filename}\">Download</a></div>` : '';
    return `${img}${dl}`;
  }
  if ((mimetype || '').startsWith('video/')) {
    const vid = `<video controls src="${src}"></video>`;
    const dl = dlHref ? `<div style="margin-top:6px"><a class=\"file-link\" href=\"${dlHref}\" download=\"${filename}\">Download</a></div>` : '';
    return `${vid}${dl}`;
  }

  // default: file link
  if (dlHref) {
    return `<a class="file-link" href="${dlHref}" download="${filename}">${filename}</a>`;
  }
  // fallback: show filename only
  return `<div>${filename}</div>`;
}

function updateViewSelect() {
  if (!viewSelectEl) return;
  // keep the selected value if still valid
  const prev = viewSelectEl.value;
  viewSelectEl.innerHTML = '<option value="">Public</option>';
  for (const name of Array.from(myGroups)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    viewSelectEl.appendChild(opt);
  }
  if (Array.from(viewSelectEl.options).some(o => o.value === prev)) {
    viewSelectEl.value = prev;
  } else {
    // if previous view disappeared, fall back to public
    viewSelectEl.value = '';
    currentView = '';
    applyViewFilter();
  }
}

function renderGroups(list) {
  availableGroups = list || [];
  // separate into yourGroups (joined or created) and public groups
  const your = availableGroups.filter(name => myGroups.has(name) || createdGroups.has(name));
  const others = availableGroups.filter(name => !your.includes(name));

  groupsListEl.innerHTML = '';

  const yourHeader = document.createElement('div');
  yourHeader.className = 'groups-header';
  yourHeader.textContent = 'Your groups';
  groupsListEl.appendChild(yourHeader);

  if (your.length === 0) {
    const none = document.createElement('div');
    none.className = 'groups-empty';
    none.textContent = 'You have no groups yet.';
    groupsListEl.appendChild(none);
  }

  for (const name of your) {
    const item = document.createElement('div');
    item.className = 'group-item';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';

    const label = document.createElement('div');
    label.textContent = name;
    label.style.cursor = 'pointer';
    label.addEventListener('click', () => {
      // clicking a group you own/joined enters it
      currentMode = 'groups';
      modeGroupsBtn && modeGroupsBtn.classList.add('mode-active');
      modeGlobalBtn && modeGlobalBtn.classList.remove('mode-active');
      currentView = name;
      if (viewSelectEl) viewSelectEl.value = name;
      applyViewFilter();
      appendSystemMessage(`Viewing ${name} — you are in this group.`);
      inputEl.focus();
    });

    left.appendChild(label);

    if (createdGroups.has(name)) {
      const owner = document.createElement('span');
      owner.className = 'group-owner';
      owner.textContent = 'Owner';
      left.insertBefore(owner, label);
    }

    item.appendChild(left);

    const actions = document.createElement('div');
    const leaveBtn = document.createElement('button');
    leaveBtn.textContent = 'Leave';
    leaveBtn.addEventListener('click', () => socket.emit('leave_group', name));
    actions.appendChild(leaveBtn);
    item.appendChild(actions);

    groupsListEl.appendChild(item);
  }

  const publicHeader = document.createElement('div');
  publicHeader.className = 'groups-header';
  publicHeader.textContent = 'All groups';
  groupsListEl.appendChild(publicHeader);

  if (others.length === 0) {
    const none2 = document.createElement('div');
    none2.className = 'groups-empty';
    none2.textContent = 'No other groups available.';
    groupsListEl.appendChild(none2);
  }

  for (const name of others) {
    const item = document.createElement('div');
    item.className = 'group-item';

    const label = document.createElement('div');
    label.textContent = name;
    label.style.cursor = 'pointer';
    label.addEventListener('click', () => {
      // auto-join optimistically when clicking any listed group so users can chat immediately
      appendSystemMessage(`Joining ${name}...`);

      // optimistic UI change
      myGroups.add(name);
      renderGroups(availableGroups);

      // switch to groups mode and enter the group
      currentMode = 'groups';
      modeGroupsBtn && modeGroupsBtn.classList.add('mode-active');
      modeGlobalBtn && modeGlobalBtn.classList.remove('mode-active');
      currentView = name;
      if (viewSelectEl) viewSelectEl.value = name;
      applyViewFilter();
      inputEl.focus();

      // notify the server
      socket.emit('join_group', name);
    });

    const actions = document.createElement('div');

    const joinBtn = document.createElement('button');
    joinBtn.textContent = 'Join';
    joinBtn.addEventListener('click', () => {
      appendSystemMessage(`Joining ${name}...`);
      myGroups.add(name);
      renderGroups(availableGroups);
      socket.emit('join_group', name);
    });

    actions.appendChild(joinBtn);
    item.appendChild(label);
    item.appendChild(actions);
    groupsListEl.appendChild(item);
  }

  updateViewSelect();
}

groupsToggle && groupsToggle.addEventListener('click', () => {
  if (!groupsPanel) return;
  groupsPanel.classList.toggle('hidden');
});

createGroupForm && createGroupForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = (groupNameInput.value || '').toString().trim();
  if (!name) return;

  // prevent duplicates locally
  if (availableGroups.includes(name)) {
    appendSystemMessage(`Group '${name}' already exists.`);
    groupNameInput.value = '';
    return;
  }

  // Optimistic UI: add group locally and enter it immediately
  appendSystemMessage(`Creating group '${name}'...`);
  availableGroups.unshift(name);
  createdGroups.add(name);
  myGroups.add(name);
  renderGroups(availableGroups);

  if (groupsPanel) groupsPanel.classList.remove('hidden');
  currentMode = 'groups';
  modeGroupsBtn && modeGroupsBtn.classList.add('mode-active');
  modeGlobalBtn && modeGlobalBtn.classList.remove('mode-active');
  currentView = name;
  if (viewSelectEl) viewSelectEl.value = name;
  applyViewFilter();
  inputEl.focus();

  socket.emit('create_group', name);
  groupNameInput.value = '';
});

socket.on('groups', list => {
  console.log('client: groups list received', list);
  renderGroups(list);
});

socket.on('group_created', name => {
  appendSystemMessage(`Group ${name} created and you joined it.`);
  // reflect immediately in UI
  if (!availableGroups.includes(name)) availableGroups.push(name);
  myGroups.add(name);
  createdGroups.add(name);
  renderGroups(availableGroups);
  // open panel and switch view to new group
  if (groupsPanel) groupsPanel.classList.remove('hidden');
  currentMode = 'groups';
  modeGroupsBtn && modeGroupsBtn.classList.add('mode-active');
  modeGlobalBtn && modeGlobalBtn.classList.remove('mode-active');
  currentView = name;
  if (viewSelectEl) viewSelectEl.value = name;
  applyViewFilter();
});

socket.on('joined_group', name => {
  myGroups.add(name);
  appendSystemMessage(`You joined ${name}.`);
  renderGroups(availableGroups);
  // auto-enter the group and switch mode
  currentMode = 'groups';
  modeGroupsBtn && modeGroupsBtn.classList.add('mode-active');
  modeGlobalBtn && modeGlobalBtn.classList.remove('mode-active');
  currentView = name;
  if (viewSelectEl) viewSelectEl.value = name;
  applyViewFilter();
  inputEl.focus();
});

socket.on('left_group', name => {
  myGroups.delete(name);
  appendSystemMessage(`You left ${name}.`);
  // if we were viewing this group, switch to public
  if (currentView === name) {
    currentView = '';
    if (viewSelectEl) viewSelectEl.value = '';
  }
  renderGroups(availableGroups);
});

socket.on('group_error', msg => {
  appendSystemMessage(msg);
  // refresh authoritative list from server to reconcile optimistic changes
  socket.emit('request_groups');
});

if (viewSelectEl) {
  viewSelectEl.addEventListener('change', e => {
    currentView = viewSelectEl.value || '';
    applyViewFilter();
  });
}

function appendGroupMessage({ group, nickname, text, timestamp, clientId }) {
  // if clientId exists and an optimistic message exists, update that message instead of duplicating
  if (clientId) {
    const existing = Array.from(messagesEl.children).find(c => c.dataset.clientId === clientId);
    if (existing) {
      const timeEl = existing.querySelector('.timestamp');
      if (timeEl) timeEl.textContent = formatTime(timestamp);
      return;
    }
  }

  const wrapper = document.createElement('div');
  wrapper.className = `message group`;
  wrapper.dataset.group = group;
  if (clientId) wrapper.dataset.clientId = clientId;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${nickname} @ ${group}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const timeEl = document.createElement('div');
  timeEl.className = 'timestamp';
  timeEl.textContent = formatTime(timestamp);

  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);
  wrapper.appendChild(timeEl);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  applyViewFilter();
}

socket.on('group_message', payload => {
  console.log('client: group_message', payload);
  appendGroupMessage(payload);
});

// file support
const attachBtnEl = document.getElementById('attach-btn');
attachBtnEl && attachBtnEl.addEventListener('click', () => fileInput && fileInput.click());
fileInput && fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) sendFile(f);
  e.target.value = '';
});

// drag and drop on the messages area
messagesEl && messagesEl.addEventListener('dragover', e => e.preventDefault());
messagesEl && messagesEl.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) sendFile(f);
});

socket.on('file_message', payload => {
  console.log('client: file_message', payload);
  appendFileMessage(payload);
});

socket.on('file_error', msg => appendSystemMessage(msg));

// update message form to send to selected target
formEl.addEventListener('submit', event => {
  event.preventDefault();
  const value = inputEl.value.trim();
  if (!value) return;

  const target = viewSelectEl && viewSelectEl.value;
  if (target) {
    if (!myGroups.has(target)) {
      appendSystemMessage('You must join the group to send messages to it.');
    } else {
      // optimistic send: create a clientId and append locally
      const clientId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      appendGroupMessage({ group: target, nickname: myNickname || 'You', text: value, timestamp: new Date().toISOString(), clientId });
      socket.emit('group_message', { group: target, text: value, clientId });
    }
  } else {
    socket.emit('chat_message', value);
  }

  inputEl.value = '';
  inputEl.focus();
});
let mediaRecorder;
let audioChunks = [];
let recording = false;
let recordStartTime = 0;
let timerInterval;

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Initialize voice controls when DOM is ready (elements may be after script)
function initVoiceControls() {
  const voiceBtn = document.getElementById("voice-btn");
  const recordingBar = document.getElementById("recording-bar");
  const recordingTimer = document.getElementById("recording-timer");

  if (!voiceBtn || !recordingBar || !recordingTimer) return;

  voiceBtn.addEventListener("click", async () => {
    if (!recording) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        appendSystemMessage('Microphone not supported in this browser.');
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        appendSystemMessage('Microphone access denied or unavailable.');
        return;
      }

      try {
        mediaRecorder = new MediaRecorder(stream);
      } catch (err) {
        appendSystemMessage('Recording not supported: ' + (err && err.message ? err.message : err));
        return;
      }

      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const duration = Date.now() - recordStartTime;

        socket.emit("voice_message", {
          audio: blob,
          duration,
          timestamp: new Date().toISOString()
        });
      };

      mediaRecorder.start();
      recording = true;
      recordStartTime = Date.now();

      voiceBtn.classList.add("recording");
      recordingBar.classList.remove("hidden");

      timerInterval = setInterval(() => {
        recordingTimer.textContent = formatDuration(Date.now() - recordStartTime);
      }, 200);

    } else {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      recording = false;

      voiceBtn.classList.remove("recording");
      recordingBar.classList.add("hidden");
      clearInterval(timerInterval);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVoiceControls);
} else {
  initVoiceControls();
}
