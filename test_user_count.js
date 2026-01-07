// quick test: connect two clients and listen for user_count
const io = require('socket.io-client');
const url = 'http://localhost:3002';

const a = io(url, { transports: ['websocket'] });
const b = io(url, { transports: ['websocket'] });

function attachLog(name, socket) {
  socket.on('connect', () => console.log(name, 'connected', socket.id));
  socket.on('user_count', c => console.log(name, 'user_count ->', c));
  socket.on('disconnect', () => console.log(name, 'disconnected'));
  socket.on('connect_error', err => console.log(name, 'connect_error', err && err.message));
}
attachLog('A', a);
attachLog('B', b);

setTimeout(() => {
  console.log('Closing B');
  b.close();
}, 2000);

setTimeout(() => {
  console.log('Closing A and exiting');
  a.close();
  process.exit(0);
}, 4000);
