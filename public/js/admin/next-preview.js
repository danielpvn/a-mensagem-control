// Segunda prévia de cada aba ("Como vai ficar"): o painel diz qual é o próximo item e o
// overlay daquele quadro (overlay.html?preview=1&next=...) desenha só ele, com o estilo de agora.
// Serve para ver se alguém mudou o estilo antes de mandar para o OBS. Nada disso vai para o OBS.
const last = {};
// Algumas abas trocam o que a prévia mostra (Bíblia com "Anúncio da leitura" na Aparência)
const override = {};

function send(mode) {
  const item = override[mode] ? override[mode].item : last[mode] ? last[mode].item : null;
  document.querySelectorAll(`iframe[data-next="${mode}"]`).forEach(frame => {
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'preview-next', item }, window.location.origin);
  });
}

export function postNext(mode, item) {
  const key = JSON.stringify(item ?? null);
  if (last[mode] && last[mode].key === key) return;
  last[mode] = { key, item: item ?? null };
  send(mode);
}

export function setNextOverride(mode, item) {
  const key = JSON.stringify(item ?? null);
  if ((override[mode] ? override[mode].key : 'null') === key) return;
  override[mode] = item ? { key, item } : null;
  send(mode);
}

export function setupNextPreviews() {
  // Quadro que (re)carregou: manda de novo o que ele tem que mostrar
  document.querySelectorAll('iframe[data-next]').forEach(frame => {
    frame.addEventListener('load', () => send(frame.dataset.next));
  });
}
