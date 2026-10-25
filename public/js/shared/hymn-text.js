// Texto dos hinos: separa estrofes e coro, monta a sequência cantada e divide em telas.
// Usado pelo servidor (require) e pelo painel/overlay (import), para tudo bater com a tela.
//
// Formato da letra (o mesmo dos arquivos da pasta tf_slides da igreja):
// - Linha em branco = nova TELA (quem cadastrou escolheu onde quebrar para ficar bonito).
// - Linhas com só "*" abrem e fecham o CORO.
// - A ESTROFE é tudo o que fica entre um coro e outro. Para separar estrofes sem coro no
//   meio, comece a estrofe com o número ("2." ou "Estrofe 2").
// - "Coro:" no começo de um bloco também marca coro (só aquele bloco).

const CHORUS_TOGGLE = /^\s*\*\s*$/;
// "Coro" sozinho na linha ou seguido de ":" (para "Coro dos anjos..." continuar sendo letra)
const CHORUS_MARK = /^\s*\[?\s*(coro|refr[aã]o|estribilho)\s*\]?\s*(?:[:.\-–]\s*(.*))?$/i;
const VERSE_MARK = /^\s*\[?\s*(?:estrofe|verso)\s*(\d+)\s*\]?\s*[:.\-–]?\s*(.*)$/i;
const NUMBER_MARK = /^\s*(\d{1,2})\s*[.)\-–:]\s*(.*)$/;
const BRACKET_MARK = /^\s*\[(\d{1,2})\]\s*(.*)$/;

// Linhas sem nenhuma letra ou número (",,,,", "[[[[", ".") são lixo de digitação
const hasContent = (line) => /[\p{L}\p{N}]/u.test(line);

// Converte a letra em seções { kind: 'verse' | 'chorus', label, text }.
// No `text` de cada seção, as telas ficam separadas por linha em branco.
export function parseLyrics(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let current = null;      // seção sendo montada
  let screen = [];         // tela sendo montada
  let inChorus = false;    // dentro de * ... *
  let blockStarted = false; // já lemos a primeira linha do bloco atual

  const closeScreen = () => {
    if (screen.length && current) current.screens.push(screen);
    screen = [];
    blockStarted = false;
  };
  const closeSection = () => {
    closeScreen();
    if (current && current.screens.length) sections.push(current);
    current = null;
  };
  const openSection = (kind, label = null) => {
    closeSection();
    current = { kind, label, explicit: label !== null, screens: [] };
  };

  // Primeira linha de um bloco: pode trazer marcação de coro ou número da estrofe
  const startBlock = (line) => {
    let match;
    if (!inChorus && (match = line.match(CHORUS_MARK))) {
      openSection('chorus');
      current.singleBlock = true;
      return match[2] || null;
    }
    if (!inChorus && ((match = line.match(VERSE_MARK)) || (match = line.match(BRACKET_MARK)) || (match = line.match(NUMBER_MARK)))) {
      openSection('verse', match[1]);
      return match[2] || null;
    }
    // Bloco solto depois de um coro começa uma estrofe nova
    if (!inChorus && (!current || current.kind === 'chorus')) openSection('verse');
    return line;
  };

  lines.forEach(raw => {
    const line = raw.trim();

    if (CHORUS_TOGGLE.test(line)) {
      if (inChorus) {
        closeSection();
        inChorus = false;
      } else {
        openSection('chorus');
        inChorus = true;
      }
      return;
    }

    if (!line) {
      closeScreen();
      // "Coro:" vale só para o próprio bloco
      if (current && current.singleBlock && current.screens.length) closeSection();
      return;
    }
    if (!hasContent(line)) return;

    if (!blockStarted) {
      const first = startBlock(line);
      blockStarted = true; // depois de startBlock, que pode ter fechado a seção anterior
      if (first) screen.push(first);
    } else {
      screen.push(line);
    }
  });
  closeSection();

  // Numera as estrofes. Hino sem coro e sem números vira uma única parte sem número
  // (não dá para saber onde começa cada estrofe, então não inventamos "Estrofe 3").
  const verses = sections.filter(s => s.kind === 'verse');
  const hasChorus = sections.some(s => s.kind === 'chorus');
  let count = 0;
  verses.forEach(s => {
    count++;
    if (!s.explicit) s.label = hasChorus || verses.length > 1 ? String(count) : null;
  });

  return sections.map(s => ({
    kind: s.kind,
    label: s.kind === 'chorus' ? 'Coro' : s.label,
    text: s.screens.map(scr => scr.join('\n')).join('\n\n')
  }));
}

// Volta as seções para texto editável (o inverso de parseLyrics)
export function sectionsToLyrics(sections) {
  return (sections || [])
    .map(s => {
      if (s.kind === 'chorus') return `*\n${s.text}\n*`;
      return s.label ? `${s.label}. ${s.text}` : s.text;
    })
    .join('\n\n');
}

// Ordem em que o hino é cantado. Com coro automático, o coro entra depois de cada estrofe
// (a menos que a própria letra já traga o coro logo em seguida).
export function buildSequence(sections, autoChorus = true) {
  const chorusIndex = sections.findIndex(s => s.kind === 'chorus');
  const sequence = [];
  sections.forEach((section, index) => {
    sequence.push(index);
    const next = sections[index + 1];
    if (autoChorus && chorusIndex !== -1 && section.kind === 'verse' && !(next && next.kind === 'chorus')) {
      sequence.push(chorusIndex);
    }
  });
  return sequence;
}

// Linhas de uma seção, sem as linhas em branco que separam as telas
export function sectionLines(text) {
  return String(text).split('\n').filter(line => line.trim());
}

// Monta as telas. Cada tela escrita na letra vira uma tela; se passar de `linesPerSlide`
// linhas, é dividida de forma equilibrada (6 linhas com limite 4 viram 3 + 3).
export function buildSlides(sections, { autoChorus = true, linesPerSlide = 4 } = {}) {
  const limit = Math.max(1, linesPerSlide);
  const slides = [];

  buildSequence(sections, autoChorus).forEach((sectionIndex, seq) => {
    const section = sections[sectionIndex];
    const chunks = [];
    let lineOffset = 0;
    section.text.split(/\n\s*\n/).forEach(screenText => {
      const lines = sectionLines(screenText);
      const parts = Math.ceil(lines.length / limit);
      const perPart = Math.ceil(lines.length / parts);
      for (let start = 0; start < lines.length; start += perPart) {
        chunks.push({ firstLine: lineOffset + start, lines: lines.slice(start, start + perPart) });
      }
      lineOffset += lines.length;
    });

    chunks.forEach((chunk, i) => {
      slides.push({
        seq,
        sectionIndex,
        kind: section.kind,
        label: section.label,
        part: i + 1,
        parts: chunks.length,
        firstLine: chunk.firstLine,
        lineCount: chunk.lines.length,
        text: chunk.lines.join('\n')
      });
    });
  });
  return slides;
}

// Nome da tela no painel: "Estrofe 2", "Coro (2/3)", "Tela 4"
export function slideName(slide) {
  if (!slide) return '';
  if (slide.kind !== 'chorus' && !slide.label) return `Tela ${slide.part}`;
  const base = slide.kind === 'chorus' ? 'Coro' : `Estrofe ${slide.label}`;
  return slide.parts > 1 ? `${base} (${slide.part}/${slide.parts})` : base;
}

// Nome que aparece na transmissão: sem número de estrofe conhecido, não mostra nada
export function screenLabel(slide) {
  if (!slide) return '';
  if (slide.kind === 'chorus') return 'Coro';
  return slide.label ? `Estrofe ${slide.label}` : '';
}
