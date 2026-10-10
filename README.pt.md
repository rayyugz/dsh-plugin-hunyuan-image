# Geração de imagens Tencent Hunyuan · Plugin nativo DSH

Languages: [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Português** · [Español](README.es.md) · [Русский](README.ru.md)

> Traz os modelos **Hy-Image-3.5-preview** e **Hy-Image-3.0** da Tencent Hunyuan para o
> [DSH (DeepSeek Harness)](https://deepseek.com) — com painel de geração, galeria local,
> o seletor de tamanho oficial em dois passos e geração em lote.
> **Zero dependências nativas. Funciona em macOS, Windows e Linux.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ Funcionalidades

- **Dois modelos**
  - `hy-image-v3.5-preview` — protocolo Chat/Messages; entrada multimodal, edição multi-turno,
    reescrita com cadeia de pensamento; saída até **4K (4096×4096)**
  - `hy-image-v3` — text-to-image clássico; reescrita de prompt e os 37 tamanhos predefinidos oficiais
- **Seletor de tamanho oficial em dois passos** — **nível de resolução × proporção**, a mesma interação
  da consola web Tencent TokenHub. O plugin converte a sua escolha na string `WxH` que a API
  espera e garante que esta cumpre as restrições oficiais
  (v3.5: lados em [256, 8192], área ≤ 16 777 216; v3.0: lados em [512, 2048], área ≤ 1 048 576).
  A interface mostra o tamanho exato que será enviado.
- **Geração em lote** — gerar **1 / 2 / 4 imagens** num único pedido (emitido em paralelo);
  os resultados são apresentados um a um com um índice `1/4`. As falhas parciais são comunicadas de forma explícita.
- **Galeria local**
  - Cada geração bem-sucedida é **guardada automaticamente** (armazenamento JSON em JS puro — sem SQLite, sem módulo nativo)
  - Vista em **grelha de miniaturas** e em lista
  - **Pesquisa por palavra-chave** (corresponde ao prompt e ao prompt reescrito) e filtragem por modelo e intervalo de tempo
  - **Painel de detalhe** com o prompt completo, modelo, tamanho, data/hora e caminho local
  - **🔁 Gerar novamente** — volta a preencher o prompt original e os parâmetros com um clique
  - **Eliminação em lote** com seleção múltipla (também remove os ficheiros locais), copiar prompt, copiar imagem
- **Pasta de gravação personalizável** — por predefinição `~/Pictures/DSH-Hunyuan-Image`, mas pode apontá-la
  para qualquer local (recomenda-se uma unidade que não seja a do sistema). Clicar em **"Escolher…"** abre o seletor de pastas nativo do sistema.
  **As alterações entram em vigor imediatamente, sem reiniciar o plugin.** Os ficheiros são organizados por mês em
  `<pasta>/<AAAA-MM>/` para evitar acumular milhares de ficheiros numa única pasta.
- **Parâmetros avançados oficiais** (limitados à sessão de propósito — ver [Roadmap](#-limitações-conhecidas-e-roadmap))

  | Parâmetro | Aplica-se a | Descrição |
  |---|---|---|
  | Semente `seed` | ambos | Reproduzir o mesmo resultado |
  | Nota de rodapé da marca de água `footnote` | ambos | ≤ 16 caracteres, desenhada no canto inferior direito |
  | Aumento por pesquisa externa `use_search_tool` | v3.5 | Deixa o modelo pesquisar na web antes de desenhar |
  | Limite de área da imagem de referência `resize_max_pixels` | v3.5 | Limita o custo em tokens de imagens de referência grandes (4K/6K) |
  | Reescrita automática do prompt `revise` | v3.0 | Acrescenta ~11 s; recomendada ativa por predefinição |

- **Imagens de referência** — carregue do disco (convertidas em data URL) ou indique um URL público.
  A v3.5 aceita até 20 (≤ 20 MB cada); a v3.0 até 3 (≤ 10 MB cada).
- **Invocável pelo modelo** — o plugin registra uma ferramenta **`hunyuan_generate_image`**, por isso basta
  dizer "desenha um gato" numa conversa e o modelo irá chamá-la.
- **Imagens duradouras** — os URLs remotos da Tencent expiram após **12 horas**; o plugin descarrega
  imediatamente para o disco cada imagem gerada, para que as entradas da galeria nunca se quebrem.

> 📌 As funcionalidades não implementadas estão listadas com honestidade em
> [Limitações conhecidas e roadmap](#-limitações-conhecidas-e-roadmap).
> Este README descreve apenas o que a versão atual faz realmente.

---

## 📦 Instalação

### Opção 1 — Instalar a partir do Release (recomendado, sem passo de compilação)

1. Descarregue `dsh-plugin-hunyuan-image-1.0.0.tgz` da página [**Releases**](../../releases).
2. Extraia-o para uma pasta permanente, por exemplo `~/dsh-plugins/`:

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. No chat do DSH, diga ao assistente:

   > Instala `~/dsh-plugins/package` como plugin DSH (usa o `plugin_manager` com `install_bundle`).

4. Reinicie o DSH.

> Instruções passo a passo de reinstalação / máquina nova: [**INSTALL.md**](INSTALL.md)
> (também disponível em [简体中文](INSTALL.zh-CN.md)).

### Opção 2 — Compilar a partir do código-fonte (programadores)

Requer **Node ≥ 20** e **pnpm**.

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # compila a metade host + empacota a metade client
node scripts/smoke-activate.mjs   # teste de fumo — deve imprimir "全部通过"

# Ligar ao profile do DSH
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows (PowerShell, administrador):
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

Depois adicione o nome do plugin ao `package.json` do profile (tanto em `dependencies` como em
`dsh.profile.bundles`) e reinicie o DSH.

---

## ⚙️ Configuração

### 1. Obter uma API Key

1. Registe-se / inicie sessão na [Tencent Cloud](https://cloud.tencent.com)
2. Ative o [serviço TokenHub](https://console.cloud.tencent.com/tokenhub)
3. Crie uma Key na [página de API Key](https://console.cloud.tencent.com/tokenhub/apikey) — tem o formato `sk-...`
4. Ative o modelo **pay-as-you-go** para `hy-image-v3.5-preview` e `hy-image-v3` em
   [Online inference → Vision models](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)

### 2. Preencher as definições do plugin

Abra o painel do plugin (botão **🖼 Hunyuan Image** por baixo do compositor) → separador **Definições**:

| Campo | Descrição | Predefinido |
|---|---|---|
| **API Key** | A Key criada acima | — |
| **Pasta de gravação** | Onde quiser; recomenda-se uma unidade que não seja a do sistema | `~/Pictures/DSH-Hunyuan-Image` |
| **Modelo predefinido** | `hy-image-v3.5-preview` ou `hy-image-v3` | v3.5-preview |
| **Resolução predefinida** | Ver [Tamanhos](#-tamanhos) | `1K` |
| **Proporção predefinida** | Ver [Tamanhos](#-tamanhos) | `1:1` |
| **Nota de rodapé da marca de água** | ≤ 16 caracteres, canto inferior direito | vazio |

Clique em **Guardar** e depois em **🔌 Testar ligação** para verificar se a Key funciona.

> ⚠️ **Nota**: as imagens são guardadas numa **subpasta mensal**, por exemplo
> `AI-images/2026-10/1791629683045-xxxx.png` — não diretamente na raiz da pasta.

---

## 🖼 Tamanhos

O plugin replica o seletor oficial do TokenHub: escolha um **nível de resolução** e uma **proporção**.

### Hy-Image-3.5-preview

| Nível | Proporções | Notas |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | Área ≈ 1M / 2,36M / 4,19M px |
| `4K` | as mesmas | Área ≤ 16 777 216 px; p. ex. 16:9 → `5461x3072` |
| `Auto` | — | Não é enviado nenhum `size`; o modelo decide |

### Hy-Image-3.0

| Nível | Proporções | Notas |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | Tem de cumprir lados ∈ [512, 2048] e área ≤ 1 048 576 |
| `Auto` | — | O modelo escolhe entre os 37 tamanhos predefinidos oficiais |

**Referência aproximada de tamanhos** (o que é efetivamente enviado):

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

As 62 combinações são todas validadas programaticamente face às restrições oficiais.

---

## 📚 Utilizar a galeria

| Ação | Como |
|---|---|
| **Pesquisar** | Caixa de pesquisa no topo (debounce de 300 ms; corresponde ao prompt / prompt reescrito / palavras-chave) |
| **Filtrar** | Por modelo e por intervalo de tempo |
| **Seleção múltipla** | Caixa de verificação no cartão, ou através da sobreposição ao passar o rato |
| **Eliminação em lote** | Selecione itens → aparece a barra de ações em lote no topo |
| **Inspecionar uma imagem** | Sobreposição ao passar o rato, ou abra o painel de detalhe |
| **Gerar novamente** | 🔁 no painel de detalhe — volta ao gerador e repõe o prompt e os parâmetros |
| **Copiar prompt** | 📋 no painel de detalhe |
| **Copiar imagem** | 🖼 no painel de detalhe (recorre à cópia do caminho local quando o navegador não tem `ClipboardItem`) |

---

## ⚠️ Limitações conhecidas e roadmap

### Limitações (impostas pela API da Tencent ou pelo host DSH)

| Item | Detalhe |
|---|---|
| **Validade do URL remoto da imagem** | Apenas 12 horas — este plugin descarrega imediatamente cada imagem para o disco, por isso as entradas da galeria são permanentes |
| **Tamanho da imagem de referência** | v3.5 ≤ 20 MB cada; v3.0 ≤ 10 MB cada |
| **Número de imagens de referência** | v3.5 ≤ 20; v3.0 ≤ 3 |
| **Nota de rodapé da marca de água** | ≤ 16 caracteres UTF-8 |
| **`generate_max_pixels` vai até 2K** | Resoluções superiores têm de passar por `size` (este plugin fá-lo através do nível de resolução) |
| **Edição multi-turno** | Só na v3.5. O plugin guarda o `assembled_history` devolvido pelo servidor, mas ainda não existe interface para edição multi-turno |
| **Os parâmetros avançados não são persistidos** | As opções de pesquisa externa, limite de área da referência e reescrita aplicam-se **apenas à sessão atual** e são repostas quando o painel é reaberto. Isto é deliberado — evita estado oculto difícil de diagnosticar mais tarde |

### Ainda não implementado

| Funcionalidade | Estado | Porquê |
|---|---|---|
| **Botão automático "abrir galeria" quando menciona a galeria** | ❌ | Exige escutar eventos de mensagens da sessão e injetar um botão de ação; não está ligado na v1.0 |
| **Diálogo Exportar / Guardar como** | ⚠️ stub | O DSH ainda não expõe aos plugins um diálogo "guardar como"; a chamada devolve um motivo explícito em vez de falhar em silêncio |
| **Partilha para WeChat / Feishu** | ⚠️ stub | O DSH ainda não expõe aos plugins um canal de partilha para IM |
| **Arrastar uma imagem para a conversa** | ❌ | Depende de o DSH expor eventos de arrastamento |
| **Interface de edição multi-turno** | ❌ | A camada de dados está pronta (`assembledHistory`); falta apenas a interface |
| **Marketplace oficial de plugins DSH** | ❌ | Requer revisão pela equipa do DSH |
| **UI do painel em vários idiomas** | ❌ | A UI dentro do painel é atualmente **apenas em chinês**; apenas o título e a descrição do plugin estão localizados (EN/ZH). Estes READMEs traduzidos são uma solução provisória |

O feedback e os pull requests são muito bem-vindos — abra uma [Issue](../../issues).

---

## 🛠 Desenvolvimento

### Estrutura do projeto

```
dsh-plugin-hunyuan-image/
├── package.json              # manifest do plugin (dsh.bundle.patch + dsh.client)
├── cordis.patch.yml          # patch do carregador Cordis: declara a linha do plugin host
├── icon.svg / locale/        # metadados de apresentação (ícone + título e descrição EN/ZH)
├── scripts/
│   ├── build-client.mjs      # empacota TS/TSX no formato de tabela de módulos do cliente DSH
│   └── smoke-activate.mjs    # teste de fumo de ativação (executar antes de reiniciar o DSH)
├── src/
│   ├── server.ts             # ★ Metade Host: entrada do plugin Cordis (apply + inject)
│   ├── client.ts             # ★ Metade Client: regista o dock do compositor + sobreposição do painel
│   ├── types.ts              # contratos de dados entre módulos
│   ├── size-presets.ts       # nível de resolução + proporção → "WxH" (com verificação de restrições)
│   ├── host/
│   │   └── routes.ts         # endpoints HTTP do host: /hunyuan/api/* e /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # wrapper fetch cliente → host
│   │   ├── config-client.ts  # cache de configuração + atualizações
│   │   ├── bus.ts            # barramento de eventos (seletor de pastas, seletor de ficheiros, …)
│   │   └── file-url.ts       # caminho local da imagem → URL carregável
│   ├── services/
│   │   ├── config.ts         # persistência da configuração (JSON, escrita atómica)
│   │   ├── storage.ts        # gestão de ficheiros locais + download de imagens (o caminho segue a configuração em tempo real)
│   │   ├── hunyuan.ts        # gateway da API Hunyuan (v3 + v3.5)
│   │   └── gallery.ts        # galeria JSON (índice em memória + escrita atómica, sem dependências nativas)
│   └── slots/
│       ├── generator-panel.tsx   # painel de geração (separador "Generate" da sobreposição)
│       ├── gallery-panel.tsx     # painel da galeria (separador "Gallery" da sobreposição)
│       └── settings-panel.tsx    # painel de definições (separador "Settings" da sobreposição)
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### Notas de arquitetura

- **Dois pontos de entrada**: `dist/server.js` é a metade Host (processo Node.js) e `dist/client.js` é a
  metade Client (navegador). Esta última tem de estar no formato `window.__ModuleLoader__.load({id, factory})`,
  produzido por `scripts/build-client.mjs` através do esbuild; o JSX é compilado à força para
  `React.createElement`, porque a tabela de módulos do DSH fornece `React` mas **não** `react/jsx-runtime`.
- **Ponto de entrada da interface**: o cliente regista um único slot `conversation.composer.dock` (um botão).
  Clicar nele abre uma sobreposição com três separadores: Generate / Gallery / Settings.
- **Cliente ↔ host**: o cliente chama o host através de `fetch('/hunyuan/api/<method>')`; as imagens são
  servidas de volta através de `/hunyuan/file?path=<caminho absoluto>` (restrito a ficheiros dentro da
  pasta de gravação configurada, para impedir path traversal).
- **Zero dependências nativas**: a galeria é um ficheiro JSON em vez de SQLite, por isso carrega bem sob
  as restrições de assinatura de código / runtime reforçado da aplicação macOS do DSH, e não precisa de
  recompilação em Windows ou Linux.

### Compilação local

```bash
pnpm install
pnpm build         # tsc → dist/ (host), esbuild → dist/client.js (client)
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### Modo de depuração

Inicie o DSH com `--plugin-debug=hunyuan-image` para obter registos detalhados.

---

## 🤝 Contribuir

Issues e pull requests são bem-vindos.

- 🐛 Encontrou um bug → [abrir um relatório de bug](../../issues/new?template=bug.md)
- 💡 Tem uma ideia → [abrir um pedido de funcionalidade](../../issues/new?template=feature.md)
- 🔧 Vai enviar código → fork, branch, PR

---

## 📄 Licença

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 Agradecimentos

- À equipa Tencent Hunyuan pela API
- À equipa DSH pela plataforma de plugins
- A todos os que abrem issues e ajudam a melhorar este plugin
