// Tocadores de vídeo com o mesmo jeito de usar para arquivo (<video>) e YouTube.
// Usado pelo overlay do OBS e pelo painel (prévia e som saindo neste computador).

let youtubeApi = null;

// Carrega a API do YouTube uma vez só (precisa de internet)
export function loadYouTubeApi() {
  if (youtubeApi) return youtubeApi;
  youtubeApi = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previous) previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      youtubeApi = null;
      reject(new Error('Sem conexão com o YouTube.'));
    };
    document.head.appendChild(script);
  });
  return youtubeApi;
}

const clampVolume = (v) => Math.min(1, Math.max(0, Number(v ?? 1)));

// Vídeo de arquivo. "ready" resolve quando o primeiro quadro (no ponto de início) já pode aparecer.
export function filePlayer(url, { start = 0, muted = true } = {}) {
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = muted;
  video.src = url;
  const ended = [];
  video.addEventListener('ended', () => ended.forEach(cb => cb()));

  const ready = new Promise(resolve => {
    video.addEventListener('loadedmetadata', () => {
      if (start > 0 && start < (video.duration || Infinity)) video.currentTime = start;
    }, { once: true });
    const done = () => resolve();
    video.addEventListener(start > 0 ? 'seeked' : 'loadeddata', done, { once: true });
    video.addEventListener('error', done, { once: true });
    setTimeout(done, 6000);
  });

  return {
    el: video,
    ready,
    play: () => { video.play().catch(() => {}); },
    pause: () => video.pause(),
    seek: (t) => { video.currentTime = Math.max(0, t); },
    time: () => video.currentTime || 0,
    duration: () => (Number.isFinite(video.duration) ? video.duration : 0),
    paused: () => video.paused,
    setMuted: (m) => { video.muted = !!m; },
    setVolume: (v) => { video.volume = clampVolume(v); },
    onEnded: (cb) => ended.push(cb),
    onError: (cb) => video.addEventListener('error', () => cb('arquivo')),
    destroy: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  };
}

// Vídeo do YouTube (iframe oficial, sem os controles do YouTube na tela).
// "ready" resolve quando ele já está tocando (ou pronto, se pausado), para a transição não mostrar o carregamento.
export function youtubePlayer(videoId, { start = 0, muted = true, autoplay = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'yt-wrap';
  const host = document.createElement('div');
  wrap.appendChild(host);

  let player = null;
  let isReady = false;
  let muteWanted = muted;
  let volumeWanted = 1;
  const ended = [];
  const errors = [];

  const ready = loadYouTubeApi().then(YT => new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    player = new YT.Player(host, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: autoplay ? 1 : 0,
        mute: muted ? 1 : 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        rel: 0,
        iv_load_policy: 3,
        playsinline: 1,
        start: Math.floor(start)
      },
      events: {
        onReady: () => {
          isReady = true;
          if (muteWanted) player.mute(); else player.unMute();
          player.setVolume(Math.round(volumeWanted * 100));
          if (!autoplay) finish();
          setTimeout(finish, 4000); // não espera para sempre se o vídeo demorar a começar
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) finish();
          if (e.data === YT.PlayerState.ENDED) ended.forEach(cb => cb());
        },
        onError: (e) => {
          finish();
          errors.forEach(cb => cb(e.data));
        }
      }
    });
  })).catch(() => {
    errors.forEach(cb => cb('offline'));
  });

  const call = (fn) => { if (player && isReady) fn(player); };
  return {
    el: wrap,
    ready,
    play: () => call(p => p.playVideo()),
    pause: () => call(p => p.pauseVideo()),
    seek: (t) => call(p => p.seekTo(Math.max(0, t), true)),
    time: () => (player && isReady ? player.getCurrentTime() || 0 : 0),
    duration: () => (player && isReady ? player.getDuration() || 0 : 0),
    paused: () => !(player && isReady) || player.getPlayerState() !== 1,
    setMuted: (m) => {
      muteWanted = !!m;
      call(p => (muteWanted ? p.mute() : p.unMute()));
    },
    setVolume: (v) => {
      volumeWanted = clampVolume(v);
      call(p => p.setVolume(Math.round(volumeWanted * 100)));
    },
    onEnded: (cb) => ended.push(cb),
    onError: (cb) => errors.push(cb),
    destroy: () => {
      try { if (player) player.destroy(); } catch (err) { /* já saiu */ }
      wrap.remove();
    }
  };
}

// Cria o tocador certo para o item da pasta de mídia
export function playerFor(item, options) {
  return item.type === 'youtube' ? youtubePlayer(item.videoId, options) : filePlayer(item.url, options);
}

// Motivo de um erro do YouTube em palavras do operador
export function youtubeErrorText(code) {
  if (code === 'offline') return 'Sem internet: o vídeo do YouTube não carregou.';
  if (code === 101 || code === 150 || code === 153) return 'O dono desse vídeo não deixa ele tocar fora do YouTube.';
  if (code === 100) return 'Esse vídeo do YouTube não existe mais ou é privado.';
  return 'O YouTube não conseguiu tocar esse vídeo.';
}
