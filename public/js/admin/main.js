// Ponto de entrada do painel do operador.
import { $, setupTabs, selectTab, getActiveTab, isModalOpen, setupSections } from './ui.js';
import * as ws from './ws.js';
import { setupLive } from './live.js';
import { setupMessage, messageControls, fetchSermons } from './message.js';
import { setupHymns, hymnControls, refreshLibrary } from './hymns.js';
import { refreshBackgrounds } from './backgrounds.js';
import { setupCloud } from './cloud.js';
import { setupBible, bibleControls } from './bible.js';
import { setupBibleAppearance } from './bible-appearance.js';
import { setupMedia, mediaControls } from './media.js';
import { setupLowerThird, toggleLowerThird } from './lowerthird.js';
import { setupPrayer } from './prayer.js';
import { setupReading } from './reading.js';
import { setupAppearance } from './appearance.js';
import { setupHymnAppearance } from './hymn-appearance.js';
import { setupConfig } from './config.js';

// Prévias: o overlay real do OBS dentro de um iframe, reduzido para caber no painel
function setupStages() {
  document.querySelectorAll('[data-stage]').forEach(stage => {
    const frame = stage.querySelector('iframe');
    const fit = () => {
      frame.style.transform = `scale(${stage.clientWidth / 1920})`;
    };
    new ResizeObserver(fit).observe(stage);
    fit();
  });
}

// Teclado e passador: comandam a aba aberta (Mensagem ou Hinos);
// nas outras abas, comandam o que foi para o ar por último
function setupKeyboard() {
  const controlsForTab = () => {
    const tab = getActiveTab();
    if (tab === 'hinos') return hymnControls;
    if (tab === 'biblia') return bibleControls;
    if (tab === 'midia') return mediaControls;
    if (tab === 'mensagem') return messageControls;
    return null;
  };

  window.addEventListener('keydown', (e) => {
    if (isModalOpen()) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    const controls = controlsForTab();
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        if (controls) controls.next();
        else ws.send('next');
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        if (controls) controls.prev();
        else ws.send('prev');
        break;
      case 'Escape':
      case '.':
      case 'b':
      case 'B':
        e.preventDefault();
        if (controls) controls.toggle();
        else ws.send('toggle-clear');
        break;
      case 'n':
      case 'N':
        // Nome do pregador: funciona em qualquer aba
        e.preventDefault();
        toggleLowerThird();
        break;
      case 'Enter':
        if (tag === 'BUTTON' || !controls) return;
        e.preventDefault();
        controls.focusSearch();
        break;
    }
  });
}

ws.onConnectionChange((connected) => {
  const badge = $('ws-status');
  badge.className = `conn ${connected ? 'is-on' : 'is-off'}`;
  badge.title = connected ? 'Conectado ao servidor' : 'Desconectado do servidor. Tentando reconectar...';
  document.body.classList.toggle('offline', !connected);
});

// Chegou novidade do banco online: recarrega as listas que mudaram
ws.on('library-changed', (changed) => {
  if (changed.sermons) fetchSermons();
  if (changed.hymns) refreshLibrary();
  if (changed.backgrounds) refreshBackgrounds();
});

setupStages();
setupLive(selectTab);
setupMessage();
setupHymns();
setupAppearance();
setupHymnAppearance();
setupBible();
setupBibleAppearance();
setupMedia();
setupLowerThird();
setupPrayer();
setupReading();
setupConfig();
setupCloud();
setupKeyboard();
setupTabs();
setupSections();
ws.connect();
