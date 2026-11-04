// Favoritos da Bíblia (aba Bíblia): passagens que a igreja usa sempre (ex: as leituras da Santa Ceia).
// Ficam guardadas neste computador (servidor) e aparecem em cima da busca. A estrela na barra "Leitura"
// guarda ou tira a passagem escolhida, junto com o "até o versículo".
import { $, toast } from './ui.js';
import * as ws from './ws.js';
import { currentPassage, presetEnd } from './reading.js';

let favorites = [];

const keyOf = (p) => `${p.book}:${p.chapter}:${p.verse || ''}:${p.end || ''}`;
const labelOf = (f) => `${f.bookName} ${f.chapter}${f.verse ? `:${f.verse}${f.end ? `-${f.end}` : ''}` : ''}`;
const save = (items) => ws.send('bible-favorites', { items });

function open(f) {
  presetEnd(f);
  ws.send('bible-select', { book: f.book, chapter: f.chapter, verse: f.verse });
  $('bible-search').blur(); // libera o Espaço/→ para passar os versículos
}

function renderList() {
  const list = $('bible-favorites-list');
  $('bible-favorites').hidden = favorites.length === 0;
  list.innerHTML = '';
  const current = currentPassage();
  const currentKey = current ? keyOf(current) : '';
  favorites.forEach(f => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    item.classList.toggle('active', f.id === currentKey);
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'fav-open';
    openBtn.textContent = labelOf(f);
    openBtn.title = 'Abrir e deixar pronto';
    openBtn.onclick = () => open(f);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'fav-remove';
    remove.textContent = '×';
    remove.title = 'Tirar dos favoritos';
    remove.onclick = () => save(favorites.filter(x => x.id !== f.id));
    item.append(openBtn, remove);
    list.appendChild(item);
  });
}

function renderStar() {
  const p = currentPassage();
  const btn = $('btn-bible-favorite');
  const on = !!p && favorites.some(f => f.id === keyOf(p));
  btn.classList.toggle('is-on', on);
  btn.title = on ? 'Tirar esta passagem dos favoritos' : 'Guardar esta passagem nos favoritos';
  $('btn-bible-favorite-label').textContent = on ? 'Favorito' : 'Favoritar';
}

function render() {
  renderList();
  renderStar();
}

export function setupBibleFavorites() {
  const onState = (state) => {
    favorites = state.bibleFavorites || [];
    render();
  };
  ws.on('init', onState);
  ws.on('update-content', onState);
  $('bible-announce-end').addEventListener('change', render);

  $('btn-bible-favorite').onclick = () => {
    const p = currentPassage();
    if (!p) return;
    const id = keyOf(p);
    if (favorites.some(f => f.id === id)) {
      save(favorites.filter(f => f.id !== id));
    } else {
      save([...favorites, p]);
      toast('Guardada nos favoritos.', 'success');
    }
  };
}
