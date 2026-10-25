// Overlay do OBS / Telão: caixa da Mensagem (rodapé) e as camadas de Hinos e Bíblia.
import { screenLabel } from './js/shared/hymn-text.js';

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
      }, transitionTimeout(look(styles).animationType));
    }
    shownKey = key;
  }

  function applyStyles() {
    const l = look(styles);
    const lower = l.layout === 'lower-third';
    layer.classList.toggle('layout-lower', lower);
    layer.classList.toggle('layout-full', !lower);
    layer.classList.toggle('text-bottom', !lower && l.position === 'bottom');

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
    return {
      key: hymn.id,
      title: showTitle ? (showNumber ? `${hymn.number} · ${hymn.title}` : hymn.title) : '',
      label: styles.showLabel !== false && styles.layout !== 'lower-third' ? screenLabel(slide) : '',
      text: slide.text
    };
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
    animationType: s.animationType
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
    animationType: s.animationType
  })
});

// ================= Mídia (imagens e vídeos em tela cheia) =================
// Duas "gavetas" sobrepostas: o item novo carrega escondido na outra gaveta e só então
// faz a transição, para nunca aparecer tela piscando ou carregando.

const mediaLayer = document.getElementById('media-layer');
const mediaSlots = [document.getElementById('media-slot-a'), document.getElementById('media-slot-b')];
let mediaStyles = {};
let mediaShown = null;      // { url, token, slot, el }
let mediaRequest = 0;       // ignora carregamentos que ficaram velhos
let lastProgressSent = 0;

const mediaDuration = () => Math.max(0, Number(mediaStyles.duration ?? 0.6));

function sendProgress(payload) {
  if (PREVIEW || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'media-progress', payload }));
}

function stopSlot(slot) {
  const video = slot.querySelector('video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  slot.innerHTML = '';
}

function applyPlayback(el, playback, restart) {
  if (!el || el.tagName !== 'VIDEO') return;
  el.muted = PREVIEW || !!playback.muted; // a prévia do painel nunca toca som
  el.volume = Math.min(1, Math.max(0, playback.volume ?? 1));
  el.loop = !!playback.loop;
  if (restart) el.currentTime = 0;
  if (playback.playing) el.play().catch(() => {});
  else el.pause();
}

function createMediaElement(item, playback, token) {
  if (item.type === 'video') {
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = PREVIEW || !!playback.muted;
    video.src = item.url;
    video.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastProgressSent < 500) return;
      lastProgressSent = now;
      sendProgress({ token, currentTime: video.currentTime, duration: video.duration || 0, paused: video.paused, ended: false });
    });
    video.addEventListener('ended', () => {
      sendProgress({ token, currentTime: video.duration || 0, duration: video.duration || 0, paused: true, ended: true });
    });
    return { el: video, ready: new Promise(resolve => { video.addEventListener('loadeddata', resolve, { once: true }); video.addEventListener('error', resolve, { once: true }); }) };
  }
  const img = document.createElement('img');
  img.src = item.url;
  img.alt = '';
  return { el: img, ready: img.decode().catch(() => {}) };
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
  setTimeout(() => { if (!mediaShown) stopSlot(leaving.slot); }, ms + 50);
}

async function updateMedia(m) {
  const item = m && !m.isCleared ? m.items[m.index] : null;
  if (!item) {
    hideMediaLayer();
    return;
  }

  const playback = m.playback || {};
  // Mesmo item no ar: só aplica tocar/pausar/som (ou recomeça se mandou de novo)
  if (mediaShown && mediaShown.url === item.url) {
    const restart = mediaShown.token !== playback.token;
    mediaShown.token = playback.token;
    applyPlayback(mediaShown.el, playback, restart);
    return;
  }

  const request = ++mediaRequest;
  const incoming = mediaShown && mediaShown.slot === mediaSlots[0] ? mediaSlots[1] : mediaSlots[0];
  const outgoing = mediaShown;
  stopSlot(incoming);
  const { el, ready } = createMediaElement(item, playback, playback.token);
  setSlotStyle(incoming, { opacity: 0 });
  incoming.appendChild(el);
  await ready;
  if (request !== mediaRequest) {
    stopSlot(incoming);
    return;
  }

  const type = mediaStyles.transition || 'crossfade';
  const ms = type === 'cut' ? 0 : mediaDuration() * 1000;
  const layerWasHidden = mediaLayer.classList.contains('hidden');
  mediaShown = { url: item.url, token: playback.token, slot: incoming, el };
  applyPlayback(el, playback, false);

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
  mediaLayer.style.background = mediaStyles.bgColor || '#000000';
  mediaLayer.classList.toggle('fit-cover', mediaStyles.fit === 'cover');
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
  if (String(ltStyles.position || 'bottom-left').startsWith('bottom')) {
    const boxes = [];
    // Usa o estado (e não a animação): durante a troca de parágrafo a caixa fica escondida por um instante
    if (!isCleared && !overlayContainer.classList.contains('telao-mode')) boxes.push(overlayBox);
    document.querySelectorAll('.screen-layer.layout-lower:not(.hidden) .screen-box').forEach(b => boxes.push(b));
    boxes.forEach(b => { lift = Math.max(lift, b.offsetHeight + 24); });
  }
  ltLayer.style.setProperty('--lt-lift', `${lift}px`);
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
  updateLowerThird(state.lowerThird);
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
