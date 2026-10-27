// Overlay do OBS / Telão: caixa da Mensagem (rodapé) e as camadas de Hinos e Bíblia.
import { screenLabel } from './js/shared/hymn-text.js';
import { playerFor, youtubeErrorText } from './js/shared/players.js';

const wsUrl = `ws://${window.location.host}`;
const reconnectInterval = 3000;
// Prévia dentro do painel: sem som e sem avisar andamento de vídeo (quem avisa é o OBS)
const PREVIEW = new URLSearchParams(window.location.search).has('preview');
let socket = null;

// DOM Elements
const overlayContainer = document.getElementById('overlay-container');
const overlayBox = document.getElementById('overlay-box');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');

const ANIMATION_CLASSES = ['anim-slide-up', 'anim-slide-side', 'anim-slide-down', 'anim-fade', 'anim-fade-slow', 'anim-clip-reveal', 'anim-zoom-in', 'anim-blur'];

// Tempo de saída de cada transição antes de trocar o texto
function transitionTimeout(animationType) {
  if (animationType === 'fade-slow') return 600;
  if (animationType === 'blur') return 350;
  return 300;
}

function outlineShadow(color, size) {
  return `-${size}px -${size}px 0 ${color}, ${size}px -${size}px 0 ${color}, -${size}px ${size}px 0 ${color}, ${size}px ${size}px 0 ${color}, 0px 2px 4px rgba(0,0,0,0.5)`;
}

function hexToRgba(hex, alpha) {
  const h = String(hex || '#000000');
  return `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${alpha})`;
}

// Fundo das camadas de tela: cor, degradê (linear ou circular) ou imagem com uma cor por cima.
// A vinheta escurece de leve as bordas e destaca o texto.
function backgroundFor(s, fallbackColor) {
  const mode = s.bgMode || (s.bgImage ? 'image' : 'color');
  const color = s.bgColor || fallbackColor;
  let css = color;
  if (mode === 'image' && s.bgImage) {
    css = `linear-gradient(${color}, ${color}), url("${s.bgImage}") center / cover no-repeat`;
  } else if (mode === 'gradient') {
    const alpha = s.gradientOpacity ?? 1;
    const from = hexToRgba(s.gradientFrom || '#0f2027', alpha);
    const to = hexToRgba(s.gradientTo || '#2c5364', alpha);
    css = s.gradientKind === 'radial'
      ? `radial-gradient(circle at 50% 38%, ${from}, ${to} 75%)`
      : `linear-gradient(${s.gradientAngle ?? 135}deg, ${from}, ${to})`;
  }
  const animate = mode === 'gradient' && !!s.gradientAnimate;
  // O movimento estica só o degradê (a vinheta fica parada do tamanho da tela)
  let size = animate ? '220% 220%' : '';
  if (s.bgVignette) {
    css = `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%), ${css}`;
    if (animate) size = `100% 100%, ${size}`;
  }
  return { css, size, animate };
}

// ================= Mensagem =================

let styleConfig = {};
let activeSermonTitle = '';
let currentParagraphNumber = null;
let currentParagraphText = '';
let isCleared = true;

// Update text content with nice out-and-in animation
function updateContent(useTransition = true) {
  if (isCleared) {
    overlayBox.classList.add('hidden');
    return;
  }

  const showTitle = styleConfig.showTitle !== false;
  const showNum = styleConfig.showParagraphNumber !== false;
  let titleStr = '';

  if (activeSermonTitle && showTitle && showNum && currentParagraphNumber) {
    titleStr = `${activeSermonTitle} - Parágrafo ${currentParagraphNumber}`;
  } else if (activeSermonTitle && showTitle) {
    titleStr = activeSermonTitle;
  } else if (showNum && currentParagraphNumber) {
    titleStr = `Parágrafo ${currentParagraphNumber}`;
  }

  const render = () => {
    overlayTitle.textContent = titleStr;
    overlayText.textContent = currentParagraphText;
    overlayTitle.style.display = titleStr ? 'block' : 'none';
    overlayBox.classList.remove('hidden');
  };

  if (useTransition && !overlayBox.classList.contains('hidden')) {
    // Já visível: esconde, troca o texto e mostra de novo para uma transição suave
    overlayBox.classList.add('hidden');
    setTimeout(render, transitionTimeout(styleConfig.animationType));
  } else {
    render();
  }
}

// Apply styles dynamically
function applyStyles() {
  if (!styleConfig) return;

  overlayBox.style.fontFamily = styleConfig.fontFamily;
  overlayText.style.fontSize = styleConfig.fontSize;
  overlayTitle.style.fontSize = styleConfig.titleSize || '0.85rem';
  overlayBox.style.textAlign = styleConfig.alignment === 'center' ? 'center' : 'left';

  overlayText.style.color = styleConfig.textColor;
  overlayTitle.style.color = styleConfig.accentColor;
  overlayBox.style.borderColor = styleConfig.accentColor;

  if (styleConfig.textOutline) {
    const oColor = styleConfig.outlineColor || '#000000';
    overlayText.style.textShadow = outlineShadow(oColor, 1.5);
    overlayTitle.style.textShadow = outlineShadow(oColor, 1);
  } else {
    overlayText.style.textShadow = 'none';
    overlayTitle.style.textShadow = 'none';
  }

  if (styleConfig.telaoMode) {
    overlayContainer.classList.add('telao-mode');
    overlayBox.style.background = '#000000';
  } else {
    overlayContainer.classList.remove('telao-mode');
    overlayBox.style.background = styleConfig.bgColor;
  }

  overlayBox.classList.remove(...ANIMATION_CLASSES);
  overlayBox.classList.add(`anim-${styleConfig.animationType || 'slide-up'}`);

  if (!isCleared) {
    updateContent(false);
  }
}

// Duração escolhida (segundos) em relação à padrão de 0,4 s
const speedOf = (s) => Math.min(5, Math.max(0.25, (Number(s.transitionTime) || 0.4) / 0.4));

// ================= Camadas de tela (Hinos e Bíblia) =================
// Tela cheia ou faixa embaixo, fundo em cor (com transparência) ou imagem, texto que
// diminui sozinho para caber e transição só no texto (o fundo não pisca na troca).

function createScreenLayer(prefix, { content, look }) {
  const layer = document.getElementById(`${prefix}-layer`);
  const box = document.getElementById(`${prefix}-box`);
  const title = document.getElementById(`${prefix}-title`);
  const text = document.getElementById(`${prefix}-text`);
  const label = document.getElementById(`${prefix}-label`);
  let styles = {};
  let state = null;
  let shownKey = null;

  const isLower = () => look(styles).layout === 'lower-third';

  // Diminui a letra até caber na área (estrofe ou versículo longo não pode sair da tela)
  function fitText(baseSize) {
    const atBottom = !isLower() && look(styles).position === 'bottom';
    const maxHeight = window.innerHeight * (isLower() ? 0.3 : atBottom ? 0.26 : 0.7);
    const maxWidth = text.parentElement.clientWidth;
    let size = baseSize;
    text.style.fontSize = `${size}rem`;
    for (let i = 0; i < 16 && (text.scrollHeight > maxHeight || text.scrollWidth > maxWidth + 1); i++) {
      size *= 0.92;
      text.style.fontSize = `${size}rem`;
    }
  }

  function setLine(el, value) {
    el.textContent = value || '';
    // Na tela cheia a linha só fica invisível (o texto não pula de lugar); na faixa ela sai de vez
    el.style.visibility = value ? 'visible' : 'hidden';
    el.style.display = !value && isLower() ? 'none' : '';
  }

  function render(slide) {
    const c = content(state, slide, styles);
    setLine(title, c.title);
    setLine(label, c.label);
    text.textContent = c.text;
    // Coro com cor própria (se o operador escolheu); o resto usa a cor da letra
    text.style.color = c.color || look(styles).textColor;
    fitText(parseFloat(look(styles).fontSize) || 4);
  }

  function currentSlide() {
    return state && !state.isCleared ? state.slides[state.slideIndex] : null;
  }

  function update(useTransition) {
    const slide = currentSlide();
    if (!slide) {
      layer.classList.add('hidden');
      shownKey = null;
      return;
    }
    const key = `${content(state, slide, styles).key}:${state.slideIndex}:${slide.text}`;
    if (layer.classList.contains('hidden') || !useTransition) {
      render(slide);
      box.classList.remove('hidden');
      layer.classList.remove('hidden');
    } else if (key !== shownKey) {
      // Troca de tela: o fundo fica, só o texto faz a transição
      box.classList.add('hidden');
      setTimeout(() => {
        render(slide);
        box.classList.remove('hidden');
      }, transitionTimeout(look(styles).animationType) * look(styles).speed);
    }
    shownKey = key;
  }

  function applyStyles() {
    const l = look(styles);
    const lower = l.layout === 'lower-third';
    layer.classList.toggle('layout-lower', lower);
    layer.classList.toggle('layout-full', !lower);
    layer.classList.toggle('text-bottom', !lower && l.position === 'bottom');
    // Velocidade da transição: multiplica todas as durações do CSS
    layer.style.setProperty('--anim-speed', l.speed);

    // Fundo: na tela cheia cobre a tela toda; na faixa, só a caixa
    const target = lower ? box : layer;
    const other = lower ? layer : box;
    target.style.background = l.background.css;
    if (l.background.size) target.style.backgroundSize = l.background.size;
    other.style.background = 'transparent';
    target.classList.toggle('bg-animated', l.background.animate);
    other.classList.remove('bg-animated');

    box.style.fontFamily = l.fontFamily;
    box.style.borderColor = l.accentColor;
    text.style.color = l.textColor;
    text.style.fontWeight = l.fontWeight;
    text.style.textAlign = l.textAlign;
    text.style.textAlignLast = l.textAlign === 'justify' ? 'center' : '';
    text.style.textTransform = l.uppercase ? 'uppercase' : 'none';
    text.style.textShadow = l.textShadow;
    [title, label].forEach(el => {
      el.style.color = l.accentColor;
      el.style.fontSize = l.titleSize;
    });

    box.classList.remove(...ANIMATION_CLASSES);
    box.classList.add(`anim-${l.animationType || 'fade'}`);

    const slide = currentSlide();
    if (slide) render(slide);
  }

  return {
    setStyles(next) {
      styles = { ...styles, ...next };
      applyStyles();
    },
    setState(next, useTransition) {
      state = next || null;
      update(useTransition);
    }
  };
}

const hymnLayer = createScreenLayer('hymn', {
  content(hymn, slide, styles) {
    const showTitle = styles.showTitle !== false && hymn.title;
    const showNumber = styles.showNumber !== false && hymn.number;
    const name = showTitle ? (showNumber ? `${hymn.number} · ${hymn.title}` : hymn.title) : '';
    const label = styles.showLabel !== false && styles.layout !== 'lower-third' ? screenLabel(slide) : '';
    // Texto embaixo (imagem com faixa no rodapé): nome e estrofe numa linha só, embaixo da letra,
    // para tudo ficar dentro da faixa
    const color = styles.chorusColorOn && slide.kind === 'chorus' ? styles.chorusColor : null;
    if (styles.layout !== 'lower-third' && styles.position === 'bottom') {
      return { key: hymn.id, title: '', label: [name, label].filter(Boolean).join(' · '), text: slide.text, color };
    }
    return { key: hymn.id, title: name, label, text: slide.text, color };
  },
  look: (s) => ({
    layout: s.layout,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize || '4.2rem',
    fontWeight: 600,
    textColor: s.textColor,
    accentColor: s.accentColor,
    titleSize: s.titleSize || '1.25rem',
    textAlign: 'center',
    uppercase: s.uppercase,
    textShadow: s.textOutline ? outlineShadow(s.outlineColor || '#000000', 2) : '0 3px 10px rgba(0,0,0,0.45)',
    background: backgroundFor(s, 'rgba(5, 8, 20, 0.9)'),
    position: s.position,
    animationType: s.animationType,
    speed: speedOf(s)
  })
});

const bibleLayer = createScreenLayer('bible', {
  content(b, slide, styles) {
    let ref = '';
    if (styles.showRef !== false) {
      ref = `${b.bookName} ${b.chapter}:${slide.verse}`;
      if (styles.showVersion) ref += ' (ACF)';
    }
    const top = styles.refPosition === 'top';
    return { key: `${b.book}:${b.chapter}`, title: top ? ref : '', label: top ? '' : ref, text: slide.text };
  },
  look: (s) => ({
    layout: s.layout,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize || '4.4rem',
    fontWeight: s.bold === false ? 400 : 700,
    textColor: s.textColor,
    accentColor: s.refColor,
    titleSize: s.refSize || '1.8rem',
    textAlign: s.textAlign || 'center',
    uppercase: false,
    textShadow: s.textShadow === false ? 'none' : '0 4px 14px rgba(0,0,0,0.6)',
    background: backgroundFor(s, 'rgba(0, 0, 0, 1)'),
    position: s.position,
    animationType: s.animationType,
    speed: speedOf(s)
  })
});

// ================= Mídia (imagens, vídeos e YouTube em tela cheia) =================
// Duas "gavetas" sobrepostas: o item novo carrega escondido na outra gaveta e só então
// faz a transição, para nunca aparecer tela piscando ou carregando.

const mediaLayer = document.getElementById('media-layer');
const mediaSlots = [document.getElementById('media-slot-a'), document.getElementById('media-slot-b')];
let mediaStyles = {};
let mediaShown = null;      // { key, token, seekId, start, loop, slot, el, player }
let mediaRequest = 0;       // ignora carregamentos que ficaram velhos
let lastPlayback = {};

const mediaDuration = () => Math.max(0, Number(mediaStyles.duration ?? 0.6));
// O som sai aqui (OBS) a não ser que o operador tenha escolhido o computador do app.
// A prévia do painel nunca toca som.
const soundHere = () => !PREVIEW && (mediaStyles.audioOutput || 'obs') !== 'app';
const itemKey = (item) => `${item.type}:${item.url}`;

function sendProgress(payload) {
  if (PREVIEW || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'media-progress', payload }));
}

// Andamento do vídeo no ar, para o painel (barra de tempo e som sincronizado)
setInterval(() => {
  const shown = mediaShown;
  if (!shown || !shown.player) return;
  sendProgress({ token: shown.token, currentTime: shown.player.time(), duration: shown.player.duration(), paused: shown.player.paused(), ended: false });
}, 500);

function stopSlot(slot) {
  if (slot.player) slot.player.destroy();
  slot.player = null;
  slot.innerHTML = '';
}

// Zoom: aproxima no ponto escolhido (x/y em %) deixando ele no centro da tela.
// Primeiro desloca o ponto para o centro, depois aumenta a partir do centro.
function zoomTransform(zoom) {
  const z = zoom || { scale: 1, x: 50, y: 50 };
  if (!z.scale || z.scale <= 1) return 'none';
  return `scale(${z.scale}) translate(${50 - z.x}%, ${50 - z.y}%)`;
}

function applyZoom(el, zoom, animate) {
  if (!el) return;
  el.style.transition = animate ? 'transform 0.8s cubic-bezier(0.45, 0, 0.25, 1)' : 'none';
  el.style.transform = zoomTransform(zoom);
}

// Tocar/pausar, som, repetir, recomeçar (do ponto de início) e pulos pedidos pelo painel
function applyPlayback(shown, playback, restart) {
  const player = shown && shown.player;
  if (!player) return;
  shown.start = playback.start || 0;
  shown.loop = !!playback.loop;
  player.setMuted(!soundHere() || !!playback.muted);
  player.setVolume(playback.volume ?? 1);
  if (restart) player.seek(shown.start);
  const seekId = playback.seek ? playback.seek.id : 0;
  if (seekId !== shown.seekId) {
    shown.seekId = seekId;
    if (!restart) player.seek(playback.seek.time);
  }
  if (playback.playing) player.play();
  else player.pause();
}

function createMediaElement(item, playback, token) {
  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    return { el: img, player: null, ready: img.decode().catch(() => {}) };
  }
  const player = playerFor(item, { start: playback.start || 0, muted: true });
  player.onEnded(() => {
    const shown = mediaShown;
    if (!shown || shown.player !== player) return;
    // Repetir volta para o ponto de início escolhido (não para o zero)
    if (shown.loop) {
      player.seek(shown.start);
      player.play();
      return;
    }
    sendProgress({ token, currentTime: player.duration(), duration: player.duration(), paused: true, ended: true });
  });
  player.onError((code) => sendProgress({ token, error: item.type === 'youtube' ? youtubeErrorText(code) : 'Não foi possível tocar este vídeo.' }));
  return { el: player.el, player, ready: player.ready };
}

// Fundo desfocado atrás da mídia (modo "Inteira com fundo desfocado"): a própria foto ampliada
// e desfocada preenche as laterais. No vídeo, usa um quadro do começo (fica parado); no YouTube, a capa.
function createBackdrop(item, el) {
  const backdrop = document.createElement('div');
  backdrop.className = 'media-backdrop';
  if (item.type === 'image') {
    backdrop.style.backgroundImage = `url("${item.url}")`;
  } else if (item.type === 'youtube') {
    backdrop.style.backgroundImage = `url("${item.thumb}")`;
  } else {
    el.addEventListener('loadeddata', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 54;
        canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
        backdrop.style.backgroundImage = `url("${canvas.toDataURL('image/jpeg', 0.7)}")`;
      } catch (err) {
        // sem fundo desfocado: fica a cor das bordas
      }
    }, { once: true });
  }
  return backdrop;
}

function setSlotStyle(slot, { opacity, transform, transition }) {
  slot.style.transition = transition || 'none';
  slot.style.opacity = opacity;
  slot.style.transform = transform || 'none';
}

function hideMediaLayer() {
  if (!mediaShown) return;
  const leaving = mediaShown;
  mediaShown = null;
  const ms = mediaStyles.transition === 'cut' ? 0 : mediaDuration() * 1000;
  mediaLayer.style.transition = `opacity ${ms}ms ease`;
  mediaLayer.classList.add('hidden');
  if (leaving.player) leaving.player.pause();
  setTimeout(() => { if (!mediaShown || mediaShown.slot !== leaving.slot) stopSlot(leaving.slot); }, ms + 50);
}

async function updateMedia(m) {
  const item = m && !m.isCleared ? m.items[m.index] : null;
  lastPlayback = (m && m.playback) || {};
  if (!item) {
    hideMediaLayer();
    return;
  }

  const playback = lastPlayback;
  // Mesmo item no ar: só aplica tocar/pausar/som/pulo (ou recomeça se mandou de novo)
  if (mediaShown && mediaShown.key === itemKey(item)) {
    const restart = mediaShown.token !== playback.token;
    mediaShown.token = playback.token;
    applyPlayback(mediaShown, playback, restart);
    applyZoom(mediaShown.el, m.zoom, true); // zoom ao vivo, com movimento suave
    return;
  }

  const request = ++mediaRequest;
  const incoming = mediaShown && mediaShown.slot === mediaSlots[0] ? mediaSlots[1] : mediaSlots[0];
  const outgoing = mediaShown;
  stopSlot(incoming);
  const { el, player, ready } = createMediaElement(item, playback, playback.token);
  incoming.player = player;
  setSlotStyle(incoming, { opacity: 0 });
  applyZoom(el, m.zoom, false); // já entra com o zoom preparado
  incoming.append(createBackdrop(item, el), el);
  await ready;
  if (request !== mediaRequest) {
    stopSlot(incoming);
    return;
  }

  const type = mediaStyles.transition || 'crossfade';
  const ms = type === 'cut' ? 0 : mediaDuration() * 1000;
  const layerWasHidden = mediaLayer.classList.contains('hidden');
  mediaShown = { key: itemKey(item), token: playback.token, seekId: playback.seek ? playback.seek.id : 0, slot: incoming, el, player };
  applyPlayback(mediaShown, lastPlayback, false);
  if (outgoing && outgoing.player) outgoing.player.pause();

  incoming.style.zIndex = 2;
  if (outgoing) outgoing.slot.style.zIndex = 1;

  if (layerWasHidden) {
    // Entrando do nada: a camada inteira aparece com a transição
    setSlotStyle(incoming, { opacity: 1 });
    mediaLayer.style.transition = `opacity ${ms}ms ease`;
    mediaLayer.classList.remove('hidden');
  } else if (type === 'fade-black') {
    if (outgoing) setSlotStyle(outgoing.slot, { opacity: 0, transition: `opacity ${ms / 2}ms ease` });
    setTimeout(() => setSlotStyle(incoming, { opacity: 1, transition: `opacity ${ms / 2}ms ease` }), ms / 2);
  } else if (type === 'slide') {
    setSlotStyle(incoming, { opacity: 1, transform: 'translateX(100%)' });
    incoming.offsetWidth; // aplica a posição inicial antes de animar
    const t = `transform ${ms}ms cubic-bezier(0.65, 0, 0.35, 1)`;
    setSlotStyle(incoming, { opacity: 1, transform: 'translateX(0)', transition: t });
    if (outgoing) setSlotStyle(outgoing.slot, { opacity: 1, transform: 'translateX(-100%)', transition: t });
  } else if (type === 'zoom') {
    setSlotStyle(incoming, { opacity: 0, transform: 'scale(1.08)' });
    incoming.offsetWidth;
    setSlotStyle(incoming, { opacity: 1, transform: 'scale(1)', transition: `opacity ${ms}ms ease, transform ${ms}ms ease` });
    if (outgoing) setSlotStyle(outgoing.slot, { opacity: 0, transition: `opacity ${ms}ms ease` });
  } else {
    // crossfade (e corte seco com 0ms)
    incoming.offsetWidth;
    setSlotStyle(incoming, { opacity: 1, transition: `opacity ${ms}ms ease` });
    if (outgoing) setSlotStyle(outgoing.slot, { opacity: 0, transition: `opacity ${ms}ms ease` });
  }

  if (outgoing) {
    setTimeout(() => {
      if (mediaShown && mediaShown.slot !== outgoing.slot) stopSlot(outgoing.slot);
    }, ms + 80);
  }
}

function applyMediaStyles() {
  const fit = mediaStyles.fit || 'blur';
  mediaLayer.style.background = mediaStyles.bgColor || '#000000';
  mediaLayer.classList.toggle('fit-cover', fit === 'cover');
  mediaLayer.classList.toggle('fit-blur', fit === 'blur');
  // Ao preencher a tela, qual parte da foto aparece (em cima = não corta a cabeça)
  const focus = { top: 'center top', center: 'center center', bottom: 'center bottom' }[mediaStyles.focus] || 'center center';
  mediaLayer.style.setProperty('--media-focus', focus);
  // Trocou onde o som sai: liga/desliga o som do vídeo no ar na hora
  if (mediaShown && mediaShown.player) mediaShown.player.setMuted(!soundHere() || !!lastPlayback.muted);
}

// ================= Nome do pregador (lower third) =================

const ltLayer = document.getElementById('lt-layer');
const ltName = document.getElementById('lt-name');
const ltSubtitle = document.getElementById('lt-subtitle');
let ltStyles = {};
let ltState = null;

function applyLowerThirdStyles() {
  const s = ltStyles;
  ltLayer.className = ltLayer.className
    .split(' ')
    .filter(c => !c.startsWith('pos-') && !c.startsWith('look-') && !c.startsWith('lt-anim-'))
    .join(' ');
  ltLayer.classList.add(`pos-${s.position || 'bottom-left'}`, `look-${s.look || 'modern'}`, `lt-anim-${s.animation || 'slide'}`);
  ltLayer.style.setProperty('--lt-scale', s.scale || 1);
  ltLayer.style.setProperty('--lt-speed', s.speed || 1);
  ltLayer.style.setProperty('--lt-name', s.nameColor || '#ffffff');
  ltLayer.style.setProperty('--lt-subtitle', s.subtitleColor || '#cbd5e1');
  ltLayer.style.setProperty('--lt-accent', s.accentColor || '#3b82f6');
  ltLayer.style.setProperty('--lt-bg', s.bgColor || 'rgba(10, 15, 30, 0.85)');
  ltLayer.style.fontFamily = s.fontFamily || 'Montserrat, sans-serif';
  liftLowerThird();
}

// Se a caixa da Mensagem ou uma faixa de hino/Bíblia estiver no rodapé, o nome sobe para não cobrir
function liftLowerThird() {
  let lift = 0;
  const boxes = [];
  // Usa o estado (e não a animação): durante a troca de parágrafo a caixa fica escondida por um instante
  if (!isCleared && !overlayContainer.classList.contains('telao-mode')) boxes.push(overlayBox);
  document.querySelectorAll('.screen-layer.layout-lower:not(.hidden) .screen-box').forEach(b => boxes.push(b));
  boxes.forEach(b => { lift = Math.max(lift, b.offsetHeight + 24); });
  ltLayer.style.setProperty('--lt-lift', String(ltStyles.position || 'bottom-left').startsWith('bottom') ? `${lift}px` : '0px');
  // O anúncio da leitura fica sempre embaixo
  readingLayer.style.setProperty('--rd-lift', `${lift}px`);
}

function updateLowerThird(lt) {
  ltState = lt || null;
  if (!ltState || !ltState.visible) {
    ltLayer.classList.add('hidden');
    return;
  }
  ltName.textContent = ltState.name;
  ltSubtitle.textContent = ltState.subtitle || '';
  ltSubtitle.style.display = ltState.subtitle ? '' : 'none';
  liftLowerThird();
  ltLayer.classList.remove('hidden');
}

// ================= Anúncio da leitura bíblica =================
// Bíblia aberta em 3D (desenho em overlay.html) com a faixa da passagem saindo da capa direita.

const readingLayer = document.getElementById('reading-layer');
const readingText = document.getElementById('reading-text');
const readingRef = document.getElementById('reading-ref');
const readingLabel = document.getElementById('reading-label');
let readingStyles = {};
let readingToken = null;
let readingHideTimer = null;

// Linhas do texto impresso nas páginas: seguem a curva da folha (mesmas curvas do desenho)
(function drawBibleLines() {
  const ns = 'http://www.w3.org/2000/svg';
  const group = document.getElementById('rd-lines');
  const top = [[14, 12], [64, 2], [120, 18]];
  const bottom = [[14, 128], [66, 114], [120, 126]];
  const q = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * t * (1 - t) * c + t * t * b;
  const yAt = (curve, x) => {
    let best = 0, dist = Infinity;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const d = Math.abs(q(curve[0][0], curve[1][0], curve[2][0], t) - x);
      if (d < dist) { dist = d; best = t; }
    }
    return q(curve[0][1], curve[1][1], curve[2][1], best);
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const line = (x1, x2, f, color, width) => {
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const x = x1 + (x2 - x1) * i / 4;
      const yt = yAt(top, x), yb = yAt(bottom, x);
      pts.push(`${x.toFixed(1)},${(yt + (yb - yt) * f).toFixed(1)}`);
    }
    const p = document.createElementNS(ns, 'polyline');
    p.setAttribute('points', pts.join(' '));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', width);
    p.setAttribute('stroke-linecap', 'round');
    group.appendChild(p);
  };
  line(52, 82, 0.055, '#9b2a22', 1.3); // título do livro
  [[22, 62], [69, 110]].forEach(([a, b]) => {
    for (let f = 0.11; f < 0.95; f += 0.031) {
      const end = rnd() < 0.13 ? a + (b - a) * (0.3 + rnd() * 0.5) : b; // fim de parágrafo
      line(a, end, f, '#6f6656', 0.75);
      if (rnd() < 0.16) line(a, a + 1.6, f, '#c0392b', 1); // número do versículo
    }
  });
})();

// Passagem comprida: a letra diminui para caber na faixa
function fitReadingText() {
  readingText.style.fontSize = '';
  const band = readingText.parentElement;
  let size = 4.2;
  for (let i = 0; i < 20 && band.scrollWidth > band.clientWidth + 1; i++) {
    size *= 0.93;
    readingText.style.fontSize = `${size}em`;
  }
}

function applyReadingStyles() {
  const s = readingStyles;
  readingLayer.style.setProperty('--rd-scale', s.scale || 1);
  readingLayer.style.setProperty('--rd-text', s.textColor || '#ffffff');
  readingLayer.style.setProperty('--rd-band', s.bandColor || '#11151c');
  readingLayer.style.setProperty('--rd-border', s.borderColor || '#c99a2e');
  readingText.style.fontFamily = s.fontFamily || "'Crimson Pro', serif";
  readingRef.style.fontFamily = s.fontFamily || "'Crimson Pro', serif";
  readingLabel.textContent = s.label ?? 'LEITURA BÍBLICA';
  readingLayer.className = readingLayer.className.split(' ').filter(c => !c.startsWith('look-')).join(' ');
  readingLayer.classList.add(`look-${s.look || 'bible3d'}`);
  fitReadingText();
}

function updateReading(state) {
  const announce = state.readingAnnounce || {};
  const text = state.serviceReading || '';
  if (announce.visible && text) {
    clearTimeout(readingHideTimer);
    if (readingText.textContent !== text) {
      readingText.textContent = text;
      readingRef.textContent = text;
      fitReadingText();
    }
    // Cada "Exibir" toca a entrada de novo
    if (announce.token !== readingToken || !readingLayer.classList.contains('show')) {
      readingToken = announce.token;
      readingLayer.classList.remove('hidden', 'leaving', 'show');
      void readingLayer.offsetWidth;
      readingLayer.classList.add('show');
    }
    return;
  }
  if (readingLayer.classList.contains('show')) {
    readingLayer.classList.remove('show');
    readingLayer.classList.add('leaving');
    clearTimeout(readingHideTimer);
    readingHideTimer = setTimeout(() => {
      readingLayer.classList.remove('leaving');
      readingLayer.classList.add('hidden');
    }, 1850);
  }
}

window.addEventListener('resize', fitReadingText);

// ================= Pedidos de oração =================
// Tela cheia: título com enfeite e os nomes em colunas (1, 2 ou 3, conforme a quantidade).
// A letra diminui sozinha quando a lista é grande.

const prayerLayer = document.getElementById('prayer-layer');
const prayerTitle = document.getElementById('prayer-title');
const prayerNames = document.getElementById('prayer-names');
let prayerStyles = {};
let prayerState = null;
let prayerKey = '';

function fitPrayerNames() {
  const names = prayerState ? prayerState.names : [];
  const cols = names.length <= 5 ? 1 : names.length <= 12 ? 2 : 3;
  const rows = Math.ceil(names.length / cols);
  prayerNames.style.gridTemplateRows = `repeat(${rows}, auto)`;
  prayerNames.style.gridTemplateColumns = `repeat(${cols}, auto)`;
  const base = 4.2 * (Number(prayerStyles.scale) || 1) * (cols === 3 ? 0.8 : 1);
  let size = base;
  prayerNames.style.fontSize = `${size}rem`;
  for (let i = 0; i < 20 && (prayerNames.scrollHeight > prayerNames.clientHeight + 1 || prayerNames.scrollWidth > prayerNames.clientWidth + 1); i++) {
    size *= 0.93;
    prayerNames.style.fontSize = `${size}rem`;
  }
}

function renderPrayer() {
  prayerTitle.textContent = prayerState.title || '';
  prayerNames.innerHTML = '';
  prayerState.names.forEach(name => {
    const div = document.createElement('div');
    div.className = 'prayer-name';
    div.textContent = name;
    prayerNames.appendChild(div);
  });
  fitPrayerNames();
}

function updatePrayer(p) {
  prayerState = p || null;
  if (!prayerState || !prayerState.visible || prayerState.names.length === 0) {
    prayerLayer.classList.add('hidden');
    prayerKey = '';
    return;
  }
  const key = `${prayerState.title}|${prayerState.names.join('|')}`;
  if (key !== prayerKey) {
    prayerKey = key;
    renderPrayer();
  }
  prayerLayer.classList.remove('hidden');
}

// A tela mudou de tamanho (OBS, prévia do painel): recalcula o tamanho da letra
window.addEventListener('resize', () => {
  if (prayerState && prayerState.names.length) fitPrayerNames();
});

function applyPrayerStyles() {
  const s = prayerStyles;
  prayerLayer.style.setProperty('--pr-accent', s.accentColor || '#f2b632');
  prayerLayer.style.setProperty('--pr-title', s.titleColor || '#f2b632');
  prayerLayer.style.setProperty('--pr-name', s.nameColor || '#ffffff');
  prayerLayer.style.fontFamily = s.fontFamily || 'Montserrat, sans-serif';
  prayerLayer.style.background = s.bgImage
    ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url("${s.bgImage}") center / cover no-repeat, ${s.bgColor || '#333333'}`
    : (s.bgColor || '#333333');
  prayerLayer.classList.toggle('no-decor', s.decor === false);
  if (prayerState && prayerState.names.length) fitPrayerNames();
}

// ================= Conexão =================

function applyState(state, useTransition) {
  activeSermonTitle = state.activeSermonTitle;
  currentParagraphNumber = state.currentParagraphNumber;
  currentParagraphText = state.currentParagraphText;
  isCleared = state.isCleared;
  updateContent(useTransition);

  hymnLayer.setState(state.hymn, useTransition);
  bibleLayer.setState(state.bible, useTransition);
  updateMedia(state.media);
  updatePrayer(state.prayer);
  updateLowerThird(state.lowerThird);
  updateReading(state);
  // As caixas mudam de altura com a animação: confere de novo depois que assentam
  setTimeout(liftLowerThird, 450);
}

function connect() {
  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.onclose = () => {
    setTimeout(connect, reconnectInterval);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'init':
          styleConfig = data.payload.styles;
          applyStyles();
          hymnLayer.setStyles(data.payload.hymnStyles || {});
          bibleLayer.setStyles(data.payload.bibleStyles || {});
          mediaStyles = data.payload.mediaStyles || {};
          applyMediaStyles();
          ltStyles = data.payload.lowerThirdStyles || {};
          applyLowerThirdStyles();
          prayerStyles = data.payload.prayerStyles || {};
          applyPrayerStyles();
          readingStyles = data.payload.readingStyles || {};
          applyReadingStyles();
          applyState(data.payload, false); // sem transição ao conectar
          break;

        case 'update-content':
          applyState(data.payload, true);
          break;

        case 'update-style':
          styleConfig = { ...styleConfig, ...data.payload };
          applyStyles();
          break;

        case 'update-hymn-style':
          hymnLayer.setStyles(data.payload);
          break;

        case 'update-bible-style':
          bibleLayer.setStyles(data.payload);
          break;

        case 'update-media-style':
          mediaStyles = { ...mediaStyles, ...data.payload };
          applyMediaStyles();
          break;

        case 'update-prayer-style':
          prayerStyles = { ...prayerStyles, ...data.payload };
          applyPrayerStyles();
          break;

        case 'update-reading-style':
          readingStyles = { ...readingStyles, ...data.payload };
          applyReadingStyles();
          break;

        case 'update-lt-style':
          ltStyles = { ...ltStyles, ...data.payload };
          applyLowerThirdStyles();
          break;
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do WebSocket:', err);
    }
  };
}

connect();
