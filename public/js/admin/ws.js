// Conexão WebSocket com o servidor local. Reconecta sozinha se cair.
const listeners = {};
let socket = null;
let onStatus = () => {};

export function on(type, handler) {
  (listeners[type] = listeners[type] || []).push(handler);
}

export function onConnectionChange(handler) {
  onStatus = handler;
}

export function send(type, payload = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
    return true;
  }
  return false;
}

export function connect() {
  socket = new WebSocket(`ws://${window.location.host}`);

  socket.onopen = () => {
    onStatus(true);
    send('register-admin');
  };

  socket.onclose = () => {
    onStatus(false);
    setTimeout(connect, 3000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      (listeners[data.type] || []).forEach(handler => handler(data.payload));
    } catch (err) {
      console.error('Erro ao ler mensagem WebSocket:', err);
    }
  };
}
