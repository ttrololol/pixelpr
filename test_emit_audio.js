// quick test: connect and emit a small audio Buffer
const { io } = require('socket.io-client');
const client = io('http://localhost:3002');
client.on('connect', () => {
  console.log('connected, sending fake buffer');
  const fake = Buffer.from([0,1,2,3,4,5,6,7]);
  client.emit('voice_message', { audio: fake, duration: 1200, timestamp: new Date().toISOString() });
  setTimeout(() => client.close(), 500);
});
client.on('connect_error', err => console.error('connect_error', err));
