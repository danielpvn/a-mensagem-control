# Instruções para o Claude: A Mensagem Control

> **Nota para o Claude:** Você está trabalhando no projeto **A Mensagem Control**. Leia este arquivo com atenção. Ele contém todas as diretrizes operacionais, fluxos de automação, repositório e padrões do projeto para que você trabalhe de forma 100% autônoma.

---

## 1. Repositório e Autenticação
- **Repositório Oficial:** `https://github.com/danielpvn/a-mensagem-control`
- **Conta GitHub do Usuário:** `danielpvn`
- **GitHub CLI (`gh`):** Já está instalado e autenticado na máquina local via `gh auth`.
- **Regra de Ouro para Releases:** **NUNCA** peça para o usuário entrar no navegador para criar releases manualmente. Quando o usuário pedir para gerar/subir uma versão ou release, **você mesmo deve executar o comando `gh release create` no terminal** para subir o ZIP automaticamente.

---

## 2. Visão Geral do Sistema
- **Objetivo:** Software desktop para transmissão de culto e projeção de sermões do pregador William Marrion Branham (e, nas próximas fases, hinos, Bíblia ACF, mídias e lower third do pregador).
- **Arquitetura:**
  - **Desktop:** Electron `v44.x` (`main.js`), Node 24 embutido.
  - **Servidor Integrado:** Node.js + Express + WebSocket nativo `ws` na porta `3000` (`server.js` + módulos em `src/`).
  - **Banco local:** SQLite nativo do Node (`node:sqlite`, sem módulo para compilar) em `Documentos/A Mensagem Control/data/amc.db` (`src/db.js`). Os JSON antigos de `data/sermons/` são importados uma única vez e ficam como backup.
  - **Painel do Operador:** `http://localhost:3000/admin.html` (`public/admin.css` + módulos ES em `public/js/admin/`).
  - **Overlay OBS / Telão:** `http://localhost:3000/overlay.html` (`public/overlay.js`, `public/overlay.css`).
  - **Fontes:** servidas localmente via `@fontsource` (`public/fonts.css`, inclui Crimson Pro), funcionam sem internet.
  - **Bíblia ACF:** o texto **não vai no repositório** (o repo é público e a ACF tem direitos da SBTB). Na primeira execução o app importa sozinho `C:	f_slides Biblia_ACF` (1.189 arquivos, um por capítulo); em outro PC, importar a pasta em Configurações.
  - **Mídias do culto:** `Documentos/A Mensagem Control/data/media/<pasta>/` (uma pasta por culto, ex: `2026-10-25`), servidas em `/media/`. Envio em streaming (até 4 GB por arquivo), também pelo celular.
  - **PIN:** `src/auth.js`. O próprio PC (localhost) nunca pede PIN; de outro aparelho, com PIN definido em Configurações, o painel redireciona para `pin.html` e a API responde 401. Overlay, `/media`, `/backgrounds`, fontes e js/css ficam livres (o OBS pode estar em outro PC). WebSocket sem PIN só recebe (e pode mandar `media-progress`).
  - **Banco online (Supabase):** projeto `https://gnhpiqxffugpvgxtsmhk.supabase.co` (chave pública em `src/cloud-config.js`; NUNCA a secreta). Biblioteca compartilhada entre as igrejas do Tabernáculo da Fé: **Mensagens, Hinos e imagens de fundo**. Ficam só no PC: pregadores, mídias do culto, Bíblia, estilos e "parou no §". Estrutura e regras em `supabase/schema.sql` (pode rodar de novo sem perder dados).
    - Papéis em `profiles.role`: `pending` (pediu acesso pelo app, não lê nada), `reader` (recebe), `editor` (publica e aprova pedidos), `blocked`. Sem login nada é lido (direitos autorais). Igrejas novas usam "Pedir acesso" em Configurações; editores aprovam na lista "Igrejas e pedidos de acesso".
    - O PC sempre usa o SQLite local; `src/sync.js` baixa a cada minuto (cursor por `updated_at` do servidor) e o editor envia logo depois de salvar. Itens alterados ficam `dirty = 1`; exclusões em `sync_deletions` viram `deleted = true` online. Hinos têm `uid` global = sha1(categoria|número|título) para a mesma pasta importada em igrejas diferentes não duplicar.
  - **Imagens de fundo:** `Documentos/A Mensagem Control/data/backgrounds`, servidas em `/backgrounds/`; na primeira vez copia `C:	f_slides\_backgrounds`.
- **Testes sem tocar nos dados reais:** `AMC_DATA_DIR=<pasta>` e `PORT=<porta>` (com `AMC_DATA_DIR` o app também não mexe no atalho da Área de Trabalho).

## 2.1 Branches
- `main`: só o que foi lançado. O atualizador das igrejas lê o `update.json` da `main`, então nada fora dela chega ao pessoal.
- `dev`: integração e testes. Cada fase sai da `dev` (`fase-0`, `fase-1`, ...) e volta para ela quando aprovada.
- Release: juntar `dev` na `main`, atualizar versão/`update.json` e seguir o fluxo da seção 4.

---

## 3. Regras de Design e Transmissão (CRÍTICO)

### Altura da Caixa e Divisão de Parágrafos
- Os parágrafos do sermão **NUNCA** devem ultrapassar **2 a 3 linhas** na tela da transmissão para **jamais cobrir o rosto ou peito do pastor**.
- **Função de Quebra (`server.js`):** `splitParagraphText(text, maxChars = 150)`. O limite de caracteres por bloco deve se manter em **~150 caracteres**.
- **Widescreen:** A caixa em `public/overlay.css` é configurada com `max-width: 1840px`, `padding: 14px 32px;` e `padding-bottom: 12px;` para ficar posicionada bem rente ao rodapé da tela.
- **Cache do OBS:** Sempre que alterar arquivos em `public/overlay.css` ou `overlay.js`, alerte o usuário para clicar em **"Atualizar cache da página atual"** nas propriedades da fonte Navegador do OBS Studio.

---

## 4. Fluxo Completo e Autônomo de Nova Release

Quando o usuário pedir para lançar ou atualizar uma versão (ex: `vX.Y.Z`):

### Passo 1: Atualizar Versão nos Arquivos
1. Em `package.json`: atualizar `"version": "X.Y.Z"`.
2. Em `server.js`: atualizar `const CURRENT_VERSION = 'X.Y.Z'`.
3. Em `update.json`: atualizar `"version": "X.Y.Z"`, a URL do ZIP para a nova tag `vX.Y.Z`, e as notas da versão.

### Passo 2: Compilar e Gerar o Executável
Execute exatamente este comando no terminal (os `--ignore` são obrigatórios: `dist` evita duplicar builds antigos e `AMensagemControl.exe` é um executável antigo de ~40MB que não deve ir no ZIP; com Electron 44 o ZIP fica em ~160MB):
```powershell
cmd /c npx electron-packager . "A Mensagem Control" --platform=win32 --arch=x64 --icon=build/icon.ico --overwrite --out=dist --ignore=dist --ignore=scratch --ignore=AMensagemControl\.exe
```

### Passo 3: Compactar o Pacote ZIP
Junte a pasta gerada e o arquivo `Instalar.bat` na raiz do ZIP:
```powershell
powershell -Command "Compress-Archive -Path 'dist/A Mensagem Control-win32-x64', 'dist/Instalar.bat' -DestinationPath 'dist/A_Mensagem_Control.zip' -Force"
```

### Passo 4: Commit e Push no Git
```powershell
git add package.json server.js update.json public/
git commit -m "feat/release: vX.Y.Z"
git push origin main
```

### Passo 5: Criar e Subir a Release Automaticamente via GitHub CLI
Execute você mesmo pelo terminal (substituindo a tag e descrição):
```powershell
gh release create vX.Y.Z "dist/A_Mensagem_Control.zip" --title "Release vX.Y.Z" --notes "Descricao das alteracoes da versao X.Y.Z"
```

### Passo 6: Informar o Link de Download Direto
Forneça sempre o link direto pronto para o usuário:
`https://github.com/danielpvn/a-mensagem-control/releases/download/vX.Y.Z/A_Mensagem_Control.zip`

### Pacote: nunca levar os dados do PC
Na máquina do usuário a pasta do projeto também é a pasta de dados (`data/amc.db`, `data/media`, `data/backgrounds`, mensagens importadas). No Passo 2 acrescente `--ignore="\.zip$" --ignore="^/data/"` e, antes de compactar, copie só a mensagem de exemplo: `data/sermons/62-1014m_a_estatura_de_um_homem_perfeito.json` para `dist/A Mensagem Control-win32-x64/resources/app/data/sermons/`.

## 4.1 Versão de teste (canal de testes)
Para o usuário e quem testa com ele receberem uma versão antes das igrejas:
- Nos PCs de teste: Configurações > Sobre > **"Receber versões de teste"** (`settings.betaUpdates`). Com ela ligada, `src/updater.js` também lê `update-beta.json` da branch **dev** e fica com a mais nova entre a oficial e a de teste. Desligada, só a oficial (`update.json` da `main`).
- Versão de teste = `X.Y.Z-beta.N` (a final `X.Y.Z` é sempre mais nova que os testes dela, então quem testa recebe a final normalmente).
- Fluxo: na branch de trabalho, colocar `X.Y.Z-beta.N` em `package.json`, `server.js` e `admin.html`; gerar exe e ZIP como nos Passos 2 e 3; `gh release create vX.Y.Z-beta.N "dist/A_Mensagem_Control.zip" --prerelease --target <branch> --title "Teste vX.Y.Z-beta.N" --notes "..."`; atualizar `update-beta.json` (versão, URL da tag e notas) e dar push na **dev**. NÃO mexer no `update.json` da `main`.
- Aprovado: juntar na `dev` e na `main` e lançar `X.Y.Z` pelo fluxo normal.

---

## 5. Estrutura de Arquivos e Funções Principais

- `main.js`: Inicialização do Electron (instância única), atalhos globais (`PageDown`, `PageUp`) para passadores Logitech R400.
- `server.js`: estado ao vivo (`globalState`), protocolo WebSocket e rotas REST.
  - Mensagens WS do painel: `select-sermon`, `show-paragraph`, `arm-paragraph`, `next`, `prev`, `toggle-clear`, `clear-screen`, `update-styles`, `reset-styles`, `hymn-select`, `hymn-show`, `hymn-playlist` (`{ items: [{ id, number, title, collection }] }`), `update-hymn-styles`, `reset-hymn-styles`, `bible-select`, `bible-show`, `update-bible-styles`, `reset-bible-styles`, `media-folder`, `media-show`, `media-arm`, `media-control` (play/pause/restart/mute/volume/loop/seek), `media-zoom` (`{ name, zoom: { scale 1-6, x, y } }`), `media-start` (`{ name, start }` em segundos), `media-order` (`{ names }`), `update-media-styles`, `reset-media-styles`, `lt-show`, `lt-hide`, `lt-toggle`, `update-lt-styles`, `reset-lt-styles`, `service-reading` (`{ text }`), `reading-show`, `reading-hide`, `update-reading-styles`, `reset-reading-styles`, `prayer-set` (`{ title, names }`), `prayer-show`, `prayer-hide`, `update-prayer-styles`, `reset-prayer-styles`. O servidor responde com `update-content` / `update-style` / `update-hymn-style` / `update-bible-style` / `update-media-style` / `update-lt-style` / `update-prayer-style` / `update-reading-style` / `media-progress` para todos (painel, celular e OBS).
  - Só um conteúdo no ar por vez (Mensagem, Hino, Bíblia, Mídia ou Pedidos de oração). O **nome do pregador** (`lowerThird`) é independente: aparece junto com qualquer um, some sozinho depois de `autoHide` segundos (timer no servidor), 10 efeitos de entrada/saída (`animation`) com velocidade (`speed`); os efeitos agem em `.lt-box`, a camada `.lt-layer` só posiciona, e sobe no overlay para não cobrir a caixa da Mensagem/faixas. "Limpar tela" tira tudo, inclusive o nome.
  - Mídia: no painel, um clique só mostra a mídia na prévia; dois cliques, Enter ou "Exibir" põem no ar. Zoom por arquivo (rodinha no ponto, arrastar, controle 1x-6x) fica salvo em `settings.mediaZooms` (`pasta/arquivo`); a mídia entra no ar com o zoom preparado, e se ela já estiver no ar o OBS aproxima suave na hora (`transform` no `img/video`, mesmas contas no painel e no overlay).
  - Mídia: a ordem é a que o operador arrasta (`settings.mediaOrder[pasta]`; o que ele não mexeu vai no fim, na ordem de envio). Vídeo do YouTube por link vira um arquivinho `<título>.youtube` (JSON `{ videoId, title }`) na pasta; o título vem do oEmbed e `t=` do link vira ponto de início. Ponto de início por vídeo em `settings.mediaStarts` (`pasta/arquivo`), escolhido na prévia ("Começar daqui"); "Recomeçar" e "Repetir" voltam para ele; `seek` pula o vídeo no ar. `playback.start` e `playback.seek = { time, id }` vão no estado.
  - Mídia: `public/js/shared/players.js` dá o mesmo jeito de tocar arquivo e YouTube (API oficial do iframe) para o overlay e o painel. Som (`mediaStyles.audioOutput`): `obs` = sai onde o link do overlay está aberto; `app` = o overlay toca mudo e a janela do programa (só Electron, nunca o celular) toca o mesmo vídeo escondido com som, acertando o tempo pelo `media-progress` do OBS (por isso o `main.js` liga `autoplayPolicy` e desliga `backgroundThrottling`).
  - Mídia: ajuste `fit` = `blur` (padrão: inteira, laterais com a própria foto desfocada), `contain` (bordas) ou `cover` (preenche; `focus` top/center/bottom escolhe a parte que aparece). O overlay do OBS (sem `?preview`) manda `media-progress`; no fim do vídeo, com `endAction: 'clear'` e sem repetir, o servidor tira da tela. As prévias do painel usam `overlay.html?preview=1` (sempre mudas, não mandam progresso).
  - `next`/`prev`/`toggle-clear` recebem `{ mode: 'message' | 'hymn' | 'bible' | 'media' }` da aba aberta; sem `mode` (passador R400 pelo `main.js`) valem para `activeLayer`, a última camada que foi ao ar.
  - Bíblia: `globalState.bible` guarda o capítulo aberto em telas: **um versículo por tela**; só divide os enormes (acima de ~450 caracteres na tela cheia, ~230 na faixa ou com texto embaixo), usando as quebras que a pasta da igreja marca. `next` no último versículo abre o próximo capítulo.
  - "Armado" (`armed`): parágrafo posicionado e oculto; o próximo `next` exibe ele. Usado no "continuar de onde parou".
  - Hinos: `hymnStyles.transitionTime` (segundos, também na Bíblia) multiplica as durações do CSS pela variável `--anim-speed`; `chorusColorOn`/`chorusColor` pintam as telas de coro. Lista do culto em `globalState.hymnPlaylist` (salva em `settings.hymnPlaylist`), com "+ Lista", "Próximo da lista" e arrastar para reordenar.
  - Aba **Culto**: pregador do dia (o que vai embaixo do nome agora é a **leitura do culto**, `globalState.serviceReading`, e não mais o nome da igreja) e **pedidos de oração** (`globalState.prayer = { visible, title, names }`, até 40 nomes, salvos em `settings.prayer`; tela cheia em 1, 2 ou 3 colunas conforme a quantidade, letra diminui sozinha; estilos em `prayerStyles`).
  - **Anúncio da leitura** (aba Culto): Bíblia de couro aberta em 3D (desenho SVG em `overlay.html`, símbolo `#rd-half`) embaixo no meio, com a faixa da passagem (`serviceReading`) saindo de trás da capa direita. Entrada: a Bíblia fechada (capa com a cruz) sobe de baixo da tela, a capa (`.rd-cover`) abre pela lombada, os marcadores descem e a faixa desliza; saída é o contrário (faixa volta para trás, capa fecha, Bíblia desce). Outros estilos (`readingStyles.look`): `bible3d` (padrão), `card` (cartão escuro), `light` (faixa clara), `line` (só texto e linha), com ícone de Bíblia e o "texto de cima" (`label`); trocar o estilo no painel já manda as cores e a fonte dele. Estado `globalState.readingAnnounce = { visible, token }`, estilos `readingStyles` (estilo, texto de cima, fonte, tamanho, cores da passagem/fundo/borda-detalhes, `autoHide`). Nome do pregador e anúncio se substituem (os dois ficam embaixo). As animações de saída têm nomes próprios: reaproveitar os da entrada com `reverse` não reinicia a animação.
  - Rotas: `/api/info`, `/api/sermons` (GET/DELETE), `/api/import`, `/api/hymns` (GET/POST), `/api/hymns/search?q=`, `/api/hymns/:id` (GET/PUT/DELETE), `/api/hymns/import`, `/api/bible/books`, `/api/bible/search?q=`, `/api/bible/chapter/:book/:chapter`, `/api/bible/import`, `/api/backgrounds` (GET/POST/DELETE), `/api/media/folders` (GET/POST/DELETE), `/api/media/items/:folder` (GET), `/api/media/upload?folder=&name=` (POST, corpo = arquivo), `/api/media/items/:folder/:name` (DELETE), `/api/media/youtube` (POST `{ folder, url }`), `/api/preachers` (GET/POST/PUT/DELETE), `/api/pin/login`, `/api/security`, `/api/security/pin`, `/api/check-update`, `/api/trigger-update`.
- `src/db.js`: SQLite (sermões, parágrafos, `settings` com os estilos, `reading_progress` com onde a leitura parou).
- `src/hymns.js`: hinos no SQLite e busca por trecho da letra em memória (sem acento, palavra pela metade, erro de digitação, frase que atravessa duas linhas).
- `public/js/shared/hymn-text.js`: módulo ES usado pelo servidor (via `require`) e pelo painel/overlay. Segue o formato dos arquivos da igreja (`C:	f_slides Hinos`, ~3.270 hinos .txt, uma subpasta por categoria):
  - **Linha em branco = nova TELA** (não nova estrofe). Linhas com só `*` abrem/fecham o **coro**, que nesses arquivos vem escrito toda vez que se repete (por isso hinos importados têm `autoChorus = false`).
  - **Estrofe = tudo entre um coro e outro.** Hino sem coro e sem número vira uma parte só ("Tela 1, 2...") e não mostra "Estrofe N" na transmissão.
  - Também aceita `Coro:` (vale só para aquele bloco) e estrofes numeradas (`2.`, `Estrofe 2`).
  - `parseLyrics`, `sectionsToLyrics` (inverso, para o editor), `buildSequence` (coro automático), `buildSlides` (cada tela escrita vira uma tela; só divide se passar de N linhas), `slideName` (painel), `screenLabel` (transmissão).
- Categoria do hino = coluna `collection` (vem do caminho da pasta na importação, ex: `Diversos / SALMOS E HINOS`; o filtro por "Diversos" inclui as subpastas). Números são guardados sem zeros à esquerda ("001" -> "1").
- `src/bible-books.js`: os 66 livros e `parseReference` ("jo 3 16", "1co 13:4-7", "sl 23"). "jo" = João; Jó só com acento ("jó") ou "job".
- `src/bible.js`: Bíblia no SQLite + índice FTS5 (busca por palavras em camadas: frase, palavras inteiras, palavra pela metade, qualquer palavra), importação da pasta e capítulos.
- `src/backgrounds.js`: biblioteca de imagens de fundo.
- `src/media.js`: pastas de mídia por culto, envio em streaming, listagem (na ordem salva), links do YouTube e exclusão.
- `src/auth.js`: PIN para outros aparelhos.
- `src/sync.js`: sincronização com o Supabase (login/pedido de acesso, baixar, enviar, aprovar igrejas). Rotas `/api/cloud/status`, `/login`, `/signup`, `/logout`, `/sync`, `/config`, `/members` (GET) e `/members/:id` (POST `{ role }`).
- `src/sermon-text.js`: `splitParagraphText(text, maxChars = 150)`, `processSermonParagraphs` (`Parágrafo X (1/Y)`), `parseRawSermonText`.
- `src/updater.js`: atualizador de 1 clique. A URL do ZIP é sempre lida do `update.json` oficial e precisa começar com `https://github.com/danielpvn/a-mensagem-control/releases/download/` (nunca aceitar URL vinda do navegador).
- `src/shortcut.js`: atalho na Área de Trabalho.
- `public/js/admin/`: `main.js` (entrada e teclado), `ws.js`, `ui.js` (toasts, confirmação, abas, grupos de ajustes que fecham/abrem pelo título e lembram o estado em `localStorage`), `live.js` (chip "No ar" e Limpar tela), `message.js` (aba Mensagem), `appearance.js` (estilos da Mensagem), `hymns.js` (aba Hinos: busca, estrofes, editor, importação de .txt/.json), `hymn-appearance.js` (estilos e temas dos hinos), `bible.js` (aba Bíblia: busca, livros/capítulos, versículos, importação), `bible-appearance.js` (estilos e temas da Bíblia, baseados nos presets antigos da igreja), `backgrounds.js` (seletor de imagem de fundo), `background-editor.js` (cor/degradê/imagem), `media.js` (aba Mídia: pastas, envio com barra de progresso, link do YouTube, miniaturas que se arrastam para reordenar, prévia com ponto de início, controles do vídeo no ar, som neste computador, aparência da mídia), `sortable.js` (arrastar para reordenar), `lowerthird.js` (aba Culto: pregador do dia e leitura do culto, tecla N em qualquer aba, chip "Nome no ar" no topo), `prayer.js` (aba Culto: pedidos de oração), `reading.js` (aba Culto: anúncio da leitura), `config.js` (aba Configurações, inclui o PIN), `cloud.js` (Banco online: status, entrar, pedir acesso, aprovar igrejas, bolinha de nuvem no topo).
- `public/overlay.js` é módulo ES: caixa da Mensagem + `createScreenLayer` genérico usado por Hinos e Bíblia (tela cheia com texto no centro ou embaixo, ou faixa embaixo; fundo `bgMode` = cor, degradê linear/circular com movimento suave opcional, ou imagem com cor por cima; vinheta opcional; texto diminui sozinho para caber; transição só no texto). No painel, `background-editor.js` monta esses controles para Bíblia e Hinos.
  - A prévia do painel é o próprio `overlay.html` dentro de um iframe escalado (1920x1080), então é fiel ao OBS.
