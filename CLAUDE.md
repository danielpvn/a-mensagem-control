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
- **Objetivo:** Software desktop para transmissão de culto e projeção de sermões do pregador William Marrion Branham.
- **Arquitetura:**
  - **Desktop:** Electron `v31.x` (`main.js`).
  - **Servidor Integrado:** Node.js + Express + WebSocket nativo `ws` na porta `3000` (`server.js`).
  - **Painel do Operador:** `http://localhost:3000/admin.html` (`public/admin.js`, `public/admin.css`).
  - **Overlay OBS / Telão:** `http://localhost:3000/overlay.html` (`public/overlay.js`, `public/overlay.css`).
  - **Banco de Sermões:** Arquivos JSON locais salvos em `data/sermons/`.

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
Execute exatamente este comando no terminal (o `--ignore=dist` é obrigatório para não duplicar builds antigos e manter o ZIP em ~125MB):
```powershell
cmd /c npx electron-packager . "A Mensagem Control" --platform=win32 --arch=x64 --icon=build/icon.ico --overwrite --out=dist --ignore=dist
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

- `main.js`: Inicialização do Electron, registro de atalhos globais (`PageDown`, `PageUp`) para passadores Logitech R400.
- `server.js`:
  - `splitParagraphText(text, maxChars = 150)`: Divide parágrafos longos em frases nas pontuações.
  - `processSermonParagraphs(paragraphs)`: Pagina em `Parágrafo X (1/Y)`.
  - `GET /api/check-update` e `POST /api/trigger-update`: Motor do atualizador automático de 1 clique.
  - `DELETE /api/sermons/:id`: Exclui sermões da biblioteca.
- `public/admin.js`:
  - Sliders de fonte: `styleSizeSlider` (`1.8rem` a `4.5rem`) e `styleTitleSizeSlider` (`0.8rem` a `2.5rem`).
  - Cor do contorno: `styleOutlineColor` com envio em tempo real.
  - Checkboxes independentes: `styleShowTitle` e `styleShowParagraphNumber`.
  - Preview escalonado proporcionalmente com fator `0.38`.
