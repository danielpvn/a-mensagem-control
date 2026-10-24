// Texto dos hinos: separa estrofes e coro, monta a sequência cantada e divide em telas.
// Usado pelo servidor (require) e pelo painel (import), para a prévia do editor bater com a tela.

// "Coro" sozinho na linha ou seguido de ":" (para "Coro dos anjos..." continuar sendo letra)
const CHORUS_MARK = /^\s*\[?\s*(coro|refr[aã]o|estribilho)\s*\]?\s*(?:[:.\-–]\s*(.*))?$/i;
const VERSE_MARK = /^\s*\[?\s*(?:estrofe|verso)\s*(\d+)\s*\]?\s*[:.\-–]?\s*(.*)$/i;
const NUMBER_MARK = /^\s*(\d{1,2})\s*[.)\-–:]\s*(.*)$/;
const BRACKET_MARK = /^\s*\[(\d{1,2})\]\s*(.*)$/;

// Converte o texto digitado/colado em seções. Blocos são separados por linha em branco.
// "Coro:" (ou "Refrão", "[Coro]") marca o coro; "1." ou "Estrofe 1" numera a estrofe.
export function parseLyrics(text) {
  const blocks = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(block => block.split('\n').map(line => line.trim()).filter(Boolean))
    .filter(lines => lines.length > 0);

  const sections = [];
  let verseCount = 0;

  blocks.forEach(lines => {
    let kind = 'verse';
    let label = null;
    const first = lines[0];
    let match;

    if ((match = first.match(CHORUS_MARK))) {
      kind = 'chorus';
      lines = match[2] ? [match[2], ...lines.slice(1)] : lines.slice(1);
    } else if ((match = first.match(VERSE_MARK)) || (match = first.match(BRACKET_MARK)) || (match = first.match(NUMBER_MARK))) {
      label = match[1];
      lines = match[2] ? [match[2], ...lines.slice(1)] : lines.slice(1);
    }

    if (lines.length === 0) return;
    if (kind === 'verse') {
      verseCount++;
      label = label || String(verseCount);
    } else {
      label = 'Coro';
    }
    sections.push({ kind, label, text: lines.join('\n') });
  });

  return sections;
}

// Volta as seções para texto editável (o inverso de parseLyrics)
export function sectionsToLyrics(sections) {
  return (sections || [])
    .map(s => (s.kind === 'chorus' ? `Coro:\n${s.text}` : `${s.label}. ${s.text}`))
    .join('\n\n');
}

// Ordem em que o hino é cantado. Com coro automático, o coro entra depois de cada estrofe
// (a menos que o próprio texto já traga o coro logo em seguida).
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

// Divide cada seção da sequência em telas de no máximo `linesPerSlide` linhas, equilibradas
// (6 linhas com limite 4 viram 3 + 3, e não 4 + 2).
export function buildSlides(sections, { autoChorus = true, linesPerSlide = 4 } = {}) {
  const slides = [];
  buildSequence(sections, autoChorus).forEach((sectionIndex, seq) => {
    const section = sections[sectionIndex];
    const lines = section.text.split('\n');
    const parts = Math.max(1, Math.ceil(lines.length / Math.max(1, linesPerSlide)));
    const perPart = Math.ceil(lines.length / parts);
    for (let part = 0; part < parts; part++) {
      const start = part * perPart;
      slides.push({
        seq,
        sectionIndex,
        kind: section.kind,
        label: section.label,
        part: part + 1,
        parts,
        firstLine: start,
        lineCount: Math.min(perPart, lines.length - start),
        text: lines.slice(start, start + perPart).join('\n')
      });
    }
  });
  return slides;
}

// Nome curto da tela: "Estrofe 2", "Coro", "Estrofe 3 (2/2)"
export function slideName(slide) {
  if (!slide) return '';
  const base = slide.kind === 'chorus' ? 'Coro' : `Estrofe ${slide.label}`;
  return slide.parts > 1 ? `${base} (${slide.part}/${slide.parts})` : base;
}
