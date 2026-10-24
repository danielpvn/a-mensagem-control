// Ponto de entrada do painel do operador.
import { $, setupTabs } from './ui.js';
import * as ws from './ws.js';
import { setupMessage } from './message.js';
import { setupAppearance } from './appearance.js';
import { setupConfig } from './config.js';

// Prévia: o overlay real do OBS dentro de um iframe, reduzido para caber no painel
function setupStage() {
  const stage = $('stage');
  const frame = $('stage-frame');
  const fit = () => {
    frame.style.transform = `scale(${stage.clientWidth / 1920})`;
  };
  new ResizeObserver(fit).observe(stage);
  fit();
}

ws.onConnectionChange((connected) => {
  const badge = $('ws-status');
  badge.className = `conn ${connected ? 'is-on' : 'is-off'}`;
  badge.title = connected ? 'Conectado ao servidor' : 'Desconectado do servidor. Tentando reconectar...';
  document.body.classList.toggle('offline', !connected);
});

setupTabs();
setupStage();
setupMessage();
setupAppearance();
setupConfig();
ws.connect();
