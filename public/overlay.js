let ws;
let wsUrl = `ws://${window.location.host}`;
let reconnectInterval = 3000;

// State
let styleConfig = {};
let activeSermonTitle = '';
let currentParagraphNumber = null;
let currentParagraphText = '';
let isCleared = true;

// DOM Elements
const overlayContainer = document.getElementById('overlay-container');
const overlayBox = document.getElementById('overlay-box');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');

// Connect WebSockets
function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Overlay conectado ao WebSocket.');
  };

  ws.onclose = () => {
    console.log('Conexão perdida. Reconectando...');
    setTimeout(connect, reconnectInterval);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'init':
          styleConfig = data.payload.styles;
          applyStyles();
          
          activeSermonTitle = data.payload.activeSermonTitle;
          currentParagraphNumber = data.payload.currentParagraphNumber;
          currentParagraphText = data.payload.currentParagraphText;
          isCleared = data.payload.isCleared;
          
          updateContent(false); // Update without transition on init
          break;

        case 'update-content':
          activeSermonTitle = data.payload.activeSermonTitle;
          currentParagraphNumber = data.payload.currentParagraphNumber;
          currentParagraphText = data.payload.currentParagraphText;
          isCleared = data.payload.isCleared;
          
          updateContent(true); // Smooth transition on content change
          break;

        case 'update-style':
          styleConfig = { ...styleConfig, ...data.payload };
          applyStyles();
          break;
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do WebSocket:', err);
    }
  };
}

// Update text content with nice out-and-in animation
function updateContent(useTransition = true) {
  if (isCleared) {
    overlayBox.classList.add('hidden');
    return;
  }

  const titleStr = activeSermonTitle && styleConfig.showTitle && currentParagraphNumber
    ? `${activeSermonTitle} - Parágrafo ${currentParagraphNumber}`
    : '';

  if (useTransition && !overlayBox.classList.contains('hidden')) {
    // If it's already visible, hide it first, change text, and show it again for a smooth transition
    overlayBox.classList.add('hidden');
    
    let transitionTimeout = 300; // default (slide-up, slide-side, fade, clip, zoom, etc.)
    if (styleConfig.animationType === 'fade-slow') {
      transitionTimeout = 600; // longer fade-out duration
    } else if (styleConfig.animationType === 'blur') {
      transitionTimeout = 350;
    }
    
    setTimeout(() => {
      overlayTitle.innerHTML = titleStr;
      overlayText.innerHTML = currentParagraphText;
      
      if (titleStr) {
        overlayTitle.style.display = 'block';
      } else {
        overlayTitle.style.display = 'none';
      }
      
      overlayBox.classList.remove('hidden');
    }, transitionTimeout);
  } else {
    // Immediate update
    overlayTitle.innerHTML = titleStr;
    overlayText.innerHTML = currentParagraphText;
    
    if (titleStr) {
      overlayTitle.style.display = 'block';
    } else {
      overlayTitle.style.display = 'none';
    }
    
    overlayBox.classList.remove('hidden');
  }
}

// Apply styles dynamically
function applyStyles() {
  if (!styleConfig) return;

  // 1. Font Family & Size
  overlayBox.style.fontFamily = styleConfig.fontFamily;
  overlayText.style.fontSize = styleConfig.fontSize;
  overlayTitle.style.fontSize = styleConfig.titleSize || '0.85rem';

  // 2. Alignment & Size overrides for text
  if (styleConfig.alignment === 'center') {
    overlayBox.style.textAlign = 'center';
  } else {
    overlayBox.style.textAlign = 'left';
  }

  // 3. Colors
  overlayText.style.color = styleConfig.textColor;
  overlayTitle.style.color = styleConfig.accentColor;
  overlayBox.style.borderColor = styleConfig.accentColor;

  if (styleConfig.textOutline) {
    const oColor = styleConfig.outlineColor || '#000000';
    overlayText.style.textShadow = `-1.5px -1.5px 0 ${oColor}, 1.5px -1.5px 0 ${oColor}, -1.5px 1.5px 0 ${oColor}, 1.5px 1.5px 0 ${oColor}, 0px 2px 4px rgba(0,0,0,0.5)`;
    overlayTitle.style.textShadow = `-1px -1px 0 ${oColor}, 1px -1px 0 ${oColor}, -1px 1px 0 ${oColor}, 1px 1px 0 ${oColor}, 0px 2px 4px rgba(0,0,0,0.5)`;
  } else {
    overlayText.style.textShadow = 'none';
    overlayTitle.style.textShadow = 'none';
  }

  // 4. Background styling
  if (styleConfig.telaoMode) {
    overlayContainer.classList.add('telao-mode');
    overlayBox.style.background = '#000000';
  } else {
    overlayContainer.classList.remove('telao-mode');
    overlayBox.style.background = styleConfig.bgColor;
  }

  // 5. Update animation type class
  // Remove all animation classes
  overlayBox.classList.remove(
    'anim-slide-up', 
    'anim-slide-side', 
    'anim-slide-down', 
    'anim-fade', 
    'anim-fade-slow', 
    'anim-clip-reveal', 
    'anim-zoom-in', 
    'anim-blur'
  );
  
  // Add selected animation class
  const animClass = `anim-${styleConfig.animationType || 'slide-up'}`;
  overlayBox.classList.add(animClass);

  // Trigger content display refresh with new style layout
  if (!isCleared) {
    updateContent(false);
  }
}

// Init
connect();
