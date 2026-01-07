// PIXELPR - Anonymous chat server

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// generate a simple random guest name
function generateGuestName() {
  const random = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `Guest-${random}`;
}

// store users in memory (socket.id -> nickname)
const users = {};
// groups store (groupName -> Set(socketIds))
const groups = {};

io.on('connection', socket => {
  console.log('socket connected:', socket.id, 'from', socket.conn.remoteAddress);
  const nickname = generateGuestName();
  users[socket.id] = nickname;

  socket.on("voice_message", data => {
    const { audio, duration, timestamp } = data;
    console.log('voice_message received from', socket.id, 'isBuffer=', Buffer.isBuffer(audio), 'type=', typeof audio, 'length=', audio && (audio.length || (audio.data && audio.data.length)));

    // If the server received a Buffer (from a browser sending binary), convert to a data URL
    let outgoingAudio = audio;
    if (audio && Buffer.isBuffer(audio)) {
      outgoingAudio = `data:audio/webm;base64,${audio.toString('base64')}`;
    }

    io.emit("voice_message", {
      nickname: users[socket.id],
      audio: outgoingAudio,
      duration,
      timestamp: timestamp || new Date().toISOString()
    });
  });

  // notify this user of their nickname
  socket.emit('welcome', {
    nickname,
    message: `Welcome to PIXELPR, ${nickname}!`
  });

  // send current groups to the connecting client
  socket.emit('groups', Object.keys(groups));

  // broadcast join event
  socket.broadcast.emit('system_message', {
    message: `${nickname} joined the chat.`,
    timestamp: new Date().toISOString()
  });

  // create a private group
  socket.on('create_group', groupName => {
    const name = (groupName || '').toString().trim();
    console.log('create_group request:', JSON.stringify(name), 'from', socket.id);
    if (!name) return socket.emit('group_error', 'Invalid group name.');
    if (groups[name]) return socket.emit('group_error', 'Group already exists.');

    groups[name] = new Set([socket.id]);
    socket.join(name);
    console.log('group created:', name, 'members:', Array.from(groups[name]));
    io.emit('groups', Object.keys(groups));
    socket.emit('group_created', name);

    // notify the creator (group system message)
    io.to(name).emit('system_message', {
      message: `Group ${name} was created.`,
      timestamp: new Date().toISOString(),
      group: name
    });

    // allow client to request current group list if needed
    socket.on('request_groups', () => {
      socket.emit('groups', Object.keys(groups));
    });
  });

  // join an existing group
  socket.on('join_group', groupName => {
    const name = (groupName || '').toString().trim();
    if (!name || !groups[name]) return socket.emit('group_error', 'Group not found.');

    groups[name].add(socket.id);
    socket.join(name);

    io.to(name).emit('system_message', {
      message: `${users[socket.id]} joined ${name}.`,
      timestamp: new Date().toISOString(),
      group: name
    });

    io.emit('groups', Object.keys(groups));
    socket.emit('joined_group', name);
  });

  // leave a group
  socket.on('leave_group', groupName => {
    const name = (groupName || '').toString().trim();
    if (!name || !groups[name]) return socket.emit('group_error', 'Group not found.');

    groups[name].delete(socket.id);
    socket.leave(name);

    // notify remaining members
    io.to(name).emit('system_message', {
      message: `${users[socket.id]} left ${name}.`,
      timestamp: new Date().toISOString(),
      group: name
    });

    // if group empty remove it
    if (groups[name].size === 0) {
      delete groups[name];
    }

    io.emit('groups', Object.keys(groups));
    socket.emit('left_group', name);
  });

  // group message
  socket.on('group_message', ({ group, text, clientId }) => {
    const name = (group || '').toString().trim();
    const msg = (text || '').toString().trim();
    if (!name || !groups[name] || !msg) return;

    const payload = {
      group: name,
      nickname: users[socket.id] || 'Unknown',
      text: msg,
      timestamp: new Date().toISOString(),
      clientId: clientId || null
    };

    io.to(name).emit('group_message', payload);
  });

  // file messages
  socket.on('file_message', ({ filename, mimetype, data, group: targetGroup, clientId }) => {
    const name = (targetGroup || '').toString().trim();
    // If group specified but doesn't exist or sender not a member, reject
    if (name && (!groups[name] || !groups[name].has(socket.id))) {
      return socket.emit('file_error', 'Cannot send to group: not a member or group not found.');
    }

    let outgoingData = data;
    if (data && Buffer.isBuffer(data)) {
      outgoingData = `data:${mimetype || 'application/octet-stream'};base64,${data.toString('base64')}`;
    }

    const payload = {
      filename: filename || 'file',
      mimetype: mimetype || 'application/octet-stream',
      data: outgoingData,
      nickname: users[socket.id],
      timestamp: new Date().toISOString(),
      group: name,
      clientId: clientId || null
    };

    console.log('file_message from', socket.id, 'group=', name, 'filename=', payload.filename, 'size=', (payload.data && payload.data.length) || 'unknown');
    if (name) {
      io.to(name).emit('file_message', payload);
    } else {
      io.emit('file_message', payload);
    }
  });

  // handle incoming chat messages
  socket.on('chat_message', msgText => {
    const trimmed = (msgText || '').toString().trim();
    if (!trimmed) return;

    const payload = {
      nickname: users[socket.id] || 'Unknown',
      text: trimmed,
      timestamp: new Date().toISOString()
    };

    // send to everyone
    io.emit('chat_message', payload);
  });

  // handle disconnect
  socket.on('disconnect', () => {
    const leftUser = users[socket.id];
    delete users[socket.id];

    // remove from any groups
    for (const name of Object.keys(groups)) {
      groups[name].delete(socket.id);
      if (groups[name].size === 0) {
        delete groups[name];
      } else {
        io.to(name).emit('system_message', {
          message: `${leftUser} left ${name}.`,
          timestamp: new Date().toISOString()
        });
      }
    }

    // send updated group list and user count
    io.emit('groups', Object.keys(groups));
    io.emit('user_count', Object.keys(users).length);

    if (leftUser) {
      socket.broadcast.emit('system_message', {
        message: `${leftUser} left the chat.`,
        timestamp: new Date().toISOString()
      });
    }
  });
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PIXELPR running at http://localhost:${PORT}`);
}).on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=${Number(PORT) + 1} npm start`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});