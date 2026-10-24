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
  - **Fontes:** servidas localmente via `@fontsource` (`public/fonts.css`), funcionam sem internet.
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

---

## 5. Estrutura de Arquivos e Funções Principais

- `main.js`: Inicialização do Electron (instância única), atalhos globais (`PageDown`, `PageUp`) para passadores Logitech R400.
- `server.js`: estado ao vivo (`globalState`), protocolo WebSocket e rotas REST.
  - Mensagens WS do painel: `select-sermon`, `show-paragraph`, `arm-paragraph`, `next`, `prev`, `toggle-clear`, `clear-screen`, `update-styles`, `reset-styles`. O servidor responde com `update-content` / `update-style` para todos (painel, celular e OBS).
  - "Armado" (`armed`): parágrafo posicionado e oculto; o próximo `next` exibe ele. Usado no "continuar de onde parou".
  - Rotas: `/api/info`, `/api/sermons` (GET/DELETE), `/api/import`, `/api/check-update`, `/api/trigger-update`.
- `src/db.js`: SQLite (sermões, parágrafos, `settings` com os estilos, `reading_progress` com onde a leitura parou).
- `src/sermon-text.js`: `splitParagraphText(text, maxChars = 150)`, `processSermonParagraphs` (`Parágrafo X (1/Y)`), `parseRawSermonText`.
- `src/updater.js`: atualizador de 1 clique. A URL do ZIP é sempre lida do `update.json` oficial e precisa começar com `https://github.com/danielpvn/a-mensagem-control/releases/download/` (nunca aceitar URL vinda do navegador).
- `src/shortcut.js`: atalho na Área de Trabalho.
- `public/js/admin/`: `main.js` (entrada), `ws.js`, `ui.js` (toasts, confirmação, abas), `message.js` (aba Mensagem), `appearance.js` (estilos), `config.js` (aba Configurações).
  - A prévia do painel é o próprio `overlay.html` dentro de um iframe escalado (1920x1080), então é fiel ao OBS.
