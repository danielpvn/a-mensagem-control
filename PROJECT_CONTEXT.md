# Contexto do Projeto: A Mensagem Control

> Este documento serve como guia completo de contexto para ser compartilhado com IAs (como o Claude) ou desenvolvedores que forem dar manutenção ou adicionar novas funcionalidades ao projeto.

---

## 1. Visão Geral do Projeto
**Nome do Projeto:** A Mensagem Control  
**Propósito:** Aplicativo desktop para igrejas cristãs voltado à transmissão e projeção ao vivo de sermões do pregador William Marrion Branham.  
**Funcionamento Básico:**
- O aplicativo roda localmente no computador da igreja (ou operador).
- Um servidor local HTTP + WebSocket (porta `3000`) serve duas interfaces principais:
  1. **Painel do Operador (`/admin.html`):** Onde o operador pesquisa, navega pelos parágrafos, altera temas/estilos em tempo real e controla a exibição.
  2. **Overlay para OBS / Telão (`/overlay.html`):** Uma página web limpa e transparente adicionada como fonte de Navegador (*Browser Source*) no OBS Studio ou exibida em tela cheia no projetor.
- Comunicação bidirecional e instantânea entre o painel do operador e o OBS via WebSockets nativos.

---

## 2. Stack Tecnológica
- **Runtime Desktop:** Electron `v31.x`
- **Backend / Servidor Local:** Node.js, Express `v4.19.2`, WebSockets nativos (`ws` `v8.16.0`)
- **Frontend:** HTML5, CSS3 moderno (Flexbox, Grid, variáveis CSS, backdrop-filter), JavaScript Vanilla (sem frameworks pesados como React/Vue para manter o app leve, rápido e de inicialização instantânea)
- **Empacotamento:** `electron-packager` (saída portátil de 64 bits para Windows) + scripts em PowerShell nativo
- **Repositório GitHub:** `https://github.com/danielpvn/a-mensagem-control`

---

## 3. Estrutura do Repositório e Arquivos Principais

```text
A Mensagem Control/
├── .gitignore               # Ignora pasta dist, binários executáveis e arquivos temporários
├── package.json             # Dependências, scripts e versão atual do app (atualmente 1.0.3)
├── main.js                  # Ponto de entrada do Electron (cria janela, registra atalhos globais)
├── server.js                # Servidor Express + WebSocket, APIs REST, motor de atualização e paginação
├── update.json              # Manifesto remoto no GitHub indicando versão mais recente e link do ZIP
│
├── public/                  # Arquivos estáticos servidos pelo Express
│   ├── admin.html           # Interface do Painel de Controle do Operador
│   ├── admin.js             # Lógica do painel, manipulação de DOM, atalhos, WebSockets e updater UI
│   ├── admin.css            # Estilização profissional dark mode do painel
│   ├── overlay.html         # Página limpa consumida pelo OBS Studio (fonte navegador)
│   ├── overlay.js           # Recepção de eventos WebSocket e animações de entrada/saída de texto
│   ├── overlay.css          # Estilos do layout lower-third, animações e widescreen
│   └── assets/              # Ícones e imagens
│
├── data/
│   └── sermons/             # Arquivos JSON contendo os sermões e parágrafos indexados
│
└── dist/                    # Pasta gerada pelo build
    ├── Instalar.bat         # Script de instalação/atalho na Área de Trabalho para a igreja
    ├── A_Mensagem_Control.zip # Pacote ZIP final distribuído para download
    └── A Mensagem Control-win32-x64/ # Binários extraídos do Electron
```

---

## 4. Funcionalidades e Mecanismos Chave

### A. Divisão Inteligente de Parágrafos (Smart Split / Paginação)
- **Problema resolvido:** Alguns parágrafos de William Branham são longos (10 a 20 linhas). Se exibidos de uma só vez, a caixa de texto sobe e cobre o rosto do pregador na transmissão.
- **Implementação (`server.js`):**
  - Função `splitParagraphText(text, maxChars = 150)` analisa o texto e busca pontuações naturais (`.`, `!`, `?`, `;`, `,`, ou espaços) em blocos curtos (~150 caracteres).
  - Função `processSermonParagraphs(paragraphs)` quebra parágrafos extensos em partes: `Parágrafo 31 (1/4)`, `Parágrafo 31 (2/4)`, etc.
  - **Garantia de Altura:** Com ~150 caracteres por bloco e widescreen de 1840px, a legenda fica com **no máximo 2 a 3 linhas** (nunca 4 ou 5), mantendo o rosto do pregador sempre desobstruído.
  - **Retroativo:** Funciona tanto ao importar mensagens novas quanto ao carregar sermões antigos da biblioteca (`/api/sermons/:id`).
  - O operador avança entre as partes com `Espaço`, `PageDown` ou passador de slides Logitech R400.

### B. Sistema de Atualização Automática em 1 Clique (One-Click Auto-Updater)
- **Fluxo:**
  1. No carregamento do `admin.js`, é feita uma requisição para `/api/check-update`.
  2. O servidor consulta o arquivo remoto `update.json` no branch `main` do GitHub.
  3. Se a versão online for maior que `CURRENT_VERSION` em `server.js`, exibe um banner verde no topo do painel: *"Nova Atualização Disponível (vX.X.X) - [Atualizar Agora]"*.
  4. Ao clicar:
     - O servidor faz o download do ZIP da Release do GitHub (tratando redirecionamentos 302 da AWS S3).
     - Extrai silenciosamente os arquivos via PowerShell (`Expand-Archive`).
     - Cria e executa um script batch temporário desvinculado (`detached`), encerra o Electron, substitui os arquivos e reabre o app atualizado automaticamente.

### C. Estilos em Tempo Real e Widescreen no OBS
- **Controles deslizantes (Sliders):**
  - **Tamanho do Texto:** Slider contínuo de `1.8rem` a `4.5rem` (padrão `2.6rem`).
  - **Tamanho do Título:** Slider de `0.8rem` a `2.5rem` (padrão `1.1rem`).
- **Contorno de Contraste nas Letras:**
  - Checkbox para ativar contorno.
  - Seletor de cores dinâmico (`style-outline-color`). Se o fundo for escuro, o contorno pode ser branco/amarelo; se for claro, preto.
  - Atualização instantânea via evento `input` sem necessidade de desmarcar a caixa.
- **Widescreen e Posição:**
  - Caixa de texto com largura máxima de `1800px` e margem inferior de `25px`, mantendo o texto o mais baixo e largo possível.
- **Modo Telão:**
  - Opção para preencher 100% da tela em fundo preto com texto centralizado (para projeção na igreja sem OBS).
- **Opções de Exibição:**
  - Checkboxes independentes para `Mostrar Título da Mensagem` e `Mostrar Número do Parágrafo`.
- **Preview Fiel:**
  - O monitor preview no painel escala proporcionalmente as fontes (escala `0.38`), mostrando a exata proporção visual do OBS.

### D. Biblioteca de Sermões e Importação Simplificada
- **Formato do Arquivo (`data/sermons/<id>.json`):**
  ```json
  {
    "id": "62-1014m",
    "title": "A Estatura de um Homem Perfeito",
    "date": "14 de Outubro de 1962",
    "paragraphs": [
      { "number": 1, "text": "Texto do parágrafo..." }
    ]
  }
  ```
- **Importação:**
  - O operador cola o texto bruto. O parser detecta números de parágrafo no padrão `54`, `[54]`, `54.` etc.
  - O identificador (`id`) é gerado automaticamente a partir do título (sem necessidade de preenchimento manual).
- **Exclusão:**
  - Botão *"Excluir Esta Mensagem"* na interface com confirmação antes de deletar o arquivo do disco via `DELETE /api/sermons/:id`.

### E. Atalhos de Teclado e Apresentador sem Fio
- Compatível nativamente com passadores Logitech (ex: R400):
  - `PageDown` / `Espaço` / `Seta Direita`: Próximo parágrafo / próxima parte.
  - `PageUp` / `Seta Esquerda`: Parágrafo anterior.
  - `Esc` / `.` / `B`: Limpar ou exibir a tela (toggle blackout).
  - `Enter`: Focar no campo de busca de parágrafo.
- Atalhos `PageDown` e `PageUp` registrados globalmente no Electron (`globalShortcut`), funcionando mesmo com o app minimizado.

---

## 5. Rotas da API REST (`server.js`)
- `GET /api/sermons`: Lista todos os sermões salvos com metadados e quantidade de parágrafos paginados.
- `GET /api/sermons/:id`: Retorna o conteúdo de um sermão específico com os parágrafos processados por `processSermonParagraphs`.
- `POST /api/import`: Processa texto colado e salva novo JSON em `data/sermons/`.
- `DELETE /api/sermons/:id`: Exclui o arquivo JSON do sermão da pasta `data/sermons/`.
- `GET /api/check-update`: Compara `CURRENT_VERSION` local com a versão remota do `update.json` no GitHub.
- `POST /api/trigger-update`: Inicia download do ZIP, descompactação e reinício do app.

---

## 6. Mensagens do WebSocket (`ws`)
- **Cliente -> Servidor:**
  - `set-sermon`: Carrega um sermão selecionado.
  - `set-paragraph`: Envia parágrafo ativo `{ index, number, text }`.
  - `clear-screen`: Oculta o overlay.
  - `update-styles`: Atualiza cores, tamanhos, fontes, transições e modos.
- **Servidor -> Clientes (Broadcast):**
  - `init`: Envia estado inicial ao conectar.
  - `update-content`: Notifica mudança de parágrafo, sermão ou visibilidade (`isCleared`).
  - `update-style`: Notifica mudança de estilos e layout.

---

## 7. Procedimento de Build e Publicação de Novas Versões

Sempre que novas alterações precisarem ser enviadas para a igreja via atualização automática:

1. **Atualizar os identificadores de versão:**
   - Em `package.json`: mudar `"version": "X.Y.Z"`
   - Em `server.js`: mudar `const CURRENT_VERSION = 'X.Y.Z'`
   - Em `update.json`: mudar `"version": "X.Y.Z"` e a URL de download para a tag correspondente `vX.Y.Z`.
2. **Empacotar o executável:**
   ```powershell
   cmd /c npx electron-packager . "A Mensagem Control" --platform=win32 --arch=x64 --icon=build/icon.ico --overwrite --out=dist --ignore=dist
   ```
   *(Nota importante: `--ignore=dist` é mandatório para não empacotar recursivamente builds antigos).*
3. **Compactar o ZIP com o instalador batch:**
   ```powershell
   powershell -Command "Compress-Archive -Path 'dist/A Mensagem Control-win32-x64', 'dist/Instalar.bat' -DestinationPath 'dist/A_Mensagem_Control.zip' -Force"
   ```
4. **Enviar commits para o GitHub:**
   ```powershell
   git add package.json server.js update.json public/
   git commit -m "release: vX.Y.Z"
   git push origin main
   ```
5. **Criar a Release no GitHub:**
   - Acessar `https://github.com/danielpvn/a-mensagem-control/releases/new`
   - Tag: `vX.Y.Z`
   - Título: `Release vX.Y.Z`
   - Anexar: `dist/A_Mensagem_Control.zip`
   - Publicar a Release.

---

## 8. Cuidados Técnicos e Armadilhas Conhecidas (Gotchas)
1. **Cache do Navegador no OBS Studio:** O OBS Studio armazena internamente em cache agressivo arquivos CSS e HTML de fontes de navegador. Se mudanças visuais no overlay não aparecerem no OBS, deve-se abrir as propriedades da fonte Navegador no OBS e clicar em **"Atualizar cache da página atual"** (*Refresh cache of current page*).
2. **Download com Redirecionamentos 302:** O GitHub Releases redireciona links de download para servidores Amazon S3 via HTTP 302. No `server.js`, a função `downloadFile` só abre o `fs.createWriteStream` após receber status 200, evitando corromper o arquivo durante o redirecionamento.
3. **Localização do `Instalar.bat`:** No pacote ZIP distribuído, o `Instalar.bat` deve ficar sempre no mesmo nível de diretório da pasta `A Mensagem Control-win32-x64`, pois o script busca `%~dp0A Mensagem Control-win32-x64`.
