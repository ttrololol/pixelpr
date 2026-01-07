const { io } = require('socket.io-client');
const fs = require('fs');
const url = 'http://localhost:3002';
const s = io(url);

s.on('connect', async () => {
  console.log('connected, sending small file');
  const data = fs.readFileSync(__filename); // send this file as test
  s.emit('file_message', { filename: 'test_file.js', mimetype: 'text/javascript', data, group: '' });
  setTimeout(()=>s.close(), 1000);
});

s.on('file_message', payload => console.log('file_message received', payload.filename, payload.mimetype, typeof payload.data));
