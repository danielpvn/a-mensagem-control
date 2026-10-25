// Processamento de texto dos sermões: divisão de parágrafos longos e importação de texto colado.

// Quebra texto de parágrafo longo em partes inteligentes com base em pontuação.
// O limite de ~150 caracteres mantém a caixa em 2-3 linhas e não cobre o rosto do pastor.
function splitParagraphText(text, maxChars = 150) {
  text = (text || '').trim();
  if (!text || text.length <= maxChars) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim());
      break;
    }

    // Procura o ponto ideal de quebra até maxChars + margem
    let sliceTarget = remaining.substring(0, maxChars + 25);

    // Prioridade 1: Pontuação forte (. ! ?) seguida de espaço/aspas
    let bestIndex = -1;
    const sentenceRegex = /[.!?]+[\s"”'’]+/g;
    let match;
    while ((match = sentenceRegex.exec(sliceTarget)) !== null) {
      const idx = match.index + match[0].length;
      if (idx <= maxChars + 25 && idx >= 50) {
        bestIndex = idx;
      }
    }

    // Prioridade 2: Ponto e vírgula, dois pontos ou travessão
    if (bestIndex === -1) {
      const clauseRegex = /[;:—\-]+[\s"”'’]+/g;
      while ((match = clauseRegex.exec(sliceTarget)) !== null) {
        const idx = match.index + match[0].length;
        if (idx <= maxChars + 25 && idx >= 50) {
          bestIndex = idx;
        }
      }
    }

    // Prioridade 3: Vírgulas
    if (bestIndex === -1) {
      const commaRegex = /[,]+[\s"”'’]+/g;
      while ((match = commaRegex.exec(sliceTarget)) !== null) {
        const idx = match.index + match[0].length;
        if (idx <= maxChars + 25 && idx >= 45) {
          bestIndex = idx;
        }
      }
    }

    // Prioridade 4: Espaço entre palavras
    if (bestIndex === -1) {
      const lastSpace = sliceTarget.lastIndexOf(' ', maxChars);
      if (lastSpace > 30) {
        bestIndex = lastSpace + 1;
      } else {
        bestIndex = maxChars;
      }
    }

    const chunk = remaining.substring(0, bestIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.substring(bestIndex).trim();
  }

  return chunks.length > 0 ? chunks : [text];
}

// Processa uma lista de parágrafos para paginar parágrafos longos em "X (1/Y)"
function processSermonParagraphs(paragraphs) {
  if (!Array.isArray(paragraphs)) return [];
  const result = [];

  paragraphs.forEach(p => {
    // Se o parágrafo já foi paginado previamente com (x/y), não re-divide
    if (typeof p.number === 'string' && /\(\d+\/\d+\)/.test(p.number)) {
      result.push(p);
      return;
    }

    const chunks = splitParagraphText(p.text, 150);
    if (chunks.length <= 1) {
      result.push({
        number: p.number,
        text: p.text
      });
    } else {
      chunks.forEach((chunk, idx) => {
        result.push({
          number: `${p.number} (${idx + 1}/${chunks.length})`,
          text: chunk
        });
      });
    }
  });

  return result;
}

// Converte o texto colado pelo operador em parágrafos numerados.
// Aceita números de parágrafo como "[54]", "54", "54.", "54 -" no início da linha.
function parseRawSermonText(rawText) {
  const lines = rawText.split('\n');
  const paragraphs = [];
  let currentParagraphText = '';
  let currentParagraphNumber = null;

  const paragraphRegex = /^(?:\[?(\d+)\]?[\s.-]+|(\d+)\s+)/;

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    const match = trimmedLine.match(paragraphRegex);

    if (match) {
      // Se já estávamos acumulando um parágrafo anterior, salva-o
      if (currentParagraphNumber !== null && currentParagraphText) {
        paragraphs.push({
          number: currentParagraphNumber,
          text: currentParagraphText.trim()
        });
      }

      // Inicia um novo parágrafo, sem a numeração no texto
      currentParagraphNumber = parseInt(match[1] || match[2], 10);
      currentParagraphText = trimmedLine.replace(paragraphRegex, '');
    } else if (currentParagraphNumber !== null) {
      // Sem numeração no início: continua o parágrafo atual
      currentParagraphText += ' ' + trimmedLine;
    } else {
      // Texto antes do primeiro parágrafo numerado
      currentParagraphNumber = paragraphs.length + 1;
      currentParagraphText = trimmedLine;
    }
  });

  // Salva o último parágrafo
  if (currentParagraphNumber !== null && currentParagraphText) {
    paragraphs.push({
      number: currentParagraphNumber,
      text: currentParagraphText.trim()
    });
  }

  return processSermonParagraphs(paragraphs);
}

// Gera um id estável a partir do título (sem acentos e caracteres especiais)
function slugify(title) {
  return title.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

module.exports = { splitParagraphText, processSermonParagraphs, parseRawSermonText, slugify };
