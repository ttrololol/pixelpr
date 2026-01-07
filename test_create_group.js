const { io } = require('socket.io-client');
const url = 'http://localhost:3002';
const s = io(url);

s.on('connect', () => {
  console.log('connected, emit create_group testGroupXYZ');
  s.emit('create_group', 'testGroupXYZ');
});

s.on('groups', g => console.log('groups:', g));
s.on('group_created', name => console.log('group_created:', name));
s.on('group_error', e => console.log('group_error:', e));
setTimeout(()=>s.close(), 2000);
