# Generación de imágenes Tencent Hunyuan · Plugin nativo para DSH

Languages: [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português](README.pt.md) · **Español** · [Русский](README.ru.md)

> Trae **Hy-Image-3.5-preview** e **Hy-Image-3.0** de Tencent Hunyuan a
> [DSH (DeepSeek Harness)](https://deepseek.com) — con panel de generación, galería local,
> el selector de tamaño oficial de dos pasos y generación por lotes.
> **Cero dependencias nativas. Funciona en macOS, Windows y Linux.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ Características

- **Dos modelos**
  - `hy-image-v3.5-preview` — protocolo Chat/Messages; entrada multimodal, edición multiturno,
    reescritura con cadena de pensamiento; salida de hasta **4K (4096×4096)**
  - `hy-image-v3` — texto a imagen clásico; reescritura de prompt y los 37 tamaños predefinidos oficiales
- **Selector de tamaño oficial de dos pasos** — **nivel de resolución × relación de aspecto**, la misma interacción que
  la consola web de Tencent TokenHub. El plugin convierte tu elección en la cadena `WxH` que la API
  espera y garantiza que cumpla las restricciones oficiales
  (v3.5: lados en [256, 8192], área ≤ 16,777,216; v3.0: lados en [512, 2048], área ≤ 1,048,576).
  La interfaz muestra el tamaño exacto que se enviará.
- **Generación por lotes** — genera **1 / 2 / 4 imágenes** en una sola solicitud (emitidas en paralelo);
  los resultados se muestran uno a uno con una insignia de índice `1/4`. Los fallos parciales se informan explícitamente.
- **Galería local**
  - Cada generación correcta se **almacena automáticamente** (almacenamiento JSON en JS puro — sin SQLite, sin módulos nativos)
  - **Cuadrícula de miniaturas** y vistas de lista
  - **Búsqueda por palabra clave** (coincide con el prompt y el prompt reescrito) más filtrado por modelo y rango de tiempo
  - **Panel de detalle** con el prompt completo, el modelo, el tamaño, la marca de tiempo y la ruta local
  - **🔁 Generar de nuevo** — rellena el prompt y los parámetros originales con un solo clic
  - **Eliminación por lotes** con selección múltiple (también borra los archivos locales), copiar prompt, copiar imagen
- **Carpeta de guardado personalizable** — por defecto `~/Pictures/DSH-Hunyuan-Image`, pero puedes apuntarla
  a cualquier lugar (se recomienda una unidad que no sea la del sistema). Al hacer clic en **"Elegir…"** se abre el selector de carpetas nativo del sistema.
  **Los cambios surten efecto de inmediato, sin necesidad de reiniciar el plugin.** Los archivos se agrupan por mes en
  `<carpeta>/<AAAA-MM>/` para evitar acumular miles de archivos en un solo directorio.
- **Parámetros avanzados oficiales** (deliberadamente limitados a la sesión — consulta la [Hoja de ruta](#️-limitaciones-conocidas-y-hoja-de-ruta))

  | Parámetro | Se aplica a | Descripción |
  |---|---|---|
  | Semilla `seed` | ambos | Reproduce el mismo resultado |
  | Pie de marca de agua `footnote` | ambos | ≤ 16 caracteres, se dibuja en la esquina inferior derecha |
  | Aumento con búsqueda externa `use_search_tool` | v3.5 | Permite al modelo buscar en la web antes de dibujar |
  | Límite de área de la imagen de referencia `resize_max_pixels` | v3.5 | Limita el coste en tokens de las imágenes de referencia grandes (4K/6K) |
  | Reescritura automática del prompt `revise` | v3.0 | Añade ~11 s; se recomienda activada por defecto |

- **Imágenes de referencia** — súbelas desde el disco (se convierten a data URL) o pasa una URL pública.
  v3.5 acepta hasta 20 (≤ 20 MB cada una); v3.0 hasta 3 (≤ 10 MB cada una).
- **Invocable por el modelo** — el plugin registra una herramienta **`hunyuan_generate_image`**, así que puedes
  simplemente decir "dibuja un gato" en una conversación y el modelo la llamará.
- **Imágenes duraderas** — las URL remotas de Tencent caducan a las **12 horas**; el plugin descarga cada
  imagen generada al disco de inmediato, así que las entradas de la galería nunca se rompen.

> 📌 Las funciones no implementadas se listan con honestidad en
> [Limitaciones conocidas y hoja de ruta](#️-limitaciones-conocidas-y-hoja-de-ruta).
> Este README solo describe lo que la versión actual hace realmente.

---

## 📦 Instalación

### Opción 1 — Instalar desde el Release (recomendado, sin paso de compilación)

1. Descarga `dsh-plugin-hunyuan-image-1.0.0.tgz` desde la página de [**Releases**](../../releases).
2. Descomprímelo en una carpeta permanente, por ejemplo `~/dsh-plugins/`:

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. En el chat de DSH, dile al asistente:

   > Instala `~/dsh-plugins/package` como plugin de DSH (usa `plugin_manager` con `install_bundle`).

4. Reinicia DSH.

> Instrucciones paso a paso para reinstalar / cambiar de equipo: [**INSTALL.md**](INSTALL.md)
> (también disponible en [简体中文](INSTALL.zh-CN.md)).

### Opción 2 — Compilar desde el código fuente (desarrolladores)

Requiere **Node ≥ 20** y **pnpm**.

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # compila la mitad host + empaqueta la mitad cliente
node scripts/smoke-activate.mjs   # prueba de humo — debería imprimir "全部通过"

# Enlázalo en el perfil de DSH
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows (PowerShell, administrador):
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

Luego añade el nombre del plugin al `package.json` del perfil (tanto en `dependencies` como en
`dsh.profile.bundles`) y reinicia DSH.

---

## ⚙️ Configuración

### 1. Obtener una API Key

1. Regístrate / inicia sesión en [Tencent Cloud](https://cloud.tencent.com)
2. Activa el [servicio TokenHub](https://console.cloud.tencent.com/tokenhub)
3. Crea una Key en la [página de API Keys](https://console.cloud.tencent.com/tokenhub/apikey) — tiene el aspecto `sk-...`
4. Habilita el **pago por uso** para `hy-image-v3.5-preview` y `hy-image-v3` en
   [Inferencia en línea → Modelos de visión](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)

### 2. Rellenar los ajustes del plugin

Abre el panel del plugin (botón **🖼 Hunyuan Image** bajo el cuadro de mensaje) → pestaña **Ajustes**:

| Campo | Descripción | Predeterminado |
|---|---|---|
| **API Key** | La Key creada arriba | — |
| **Carpeta de guardado** | Donde quieras; se recomienda una unidad que no sea la del sistema | `~/Pictures/DSH-Hunyuan-Image` |
| **Modelo predeterminado** | `hy-image-v3.5-preview` o `hy-image-v3` | v3.5-preview |
| **Resolución predeterminada** | Consulta [Tamaños](#-tamaños) | `1K` |
| **Relación de aspecto predeterminada** | Consulta [Tamaños](#-tamaños) | `1:1` |
| **Pie de marca de agua** | ≤ 16 caracteres, esquina inferior derecha | vacío |

Haz clic en **Guardar** y luego en **🔌 Probar conexión** para verificar que la Key funciona.

> ⚠️ **Nota**: las imágenes se guardan en una **subcarpeta por mes**, por ejemplo
> `AI-images/2026-10/1791629683045-xxxx.png` — no directamente en la raíz de la carpeta.

---

## 🖼 Tamaños

El plugin replica el selector oficial de TokenHub: elige un **nivel de resolución** y una **relación de aspecto**.

### Hy-Image-3.5-preview

| Nivel | Relaciones de aspecto | Notas |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | Área ≈ 1M / 2.36M / 4.19M px |
| `4K` | las mismas | Área ≤ 16,777,216 px; p. ej. 16:9 → `5461x3072` |
| `Auto` | — | No se envía `size`; el modelo decide |

### Hy-Image-3.0

| Nivel | Relaciones de aspecto | Notas |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | Debe cumplir lados ∈ [512, 2048] y área ≤ 1,048,576 |
| `Auto` | — | El modelo elige entre los 37 tamaños predefinidos oficiales |

**Referencia aproximada de tamaños** (lo que realmente se envía):

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

Las 62 combinaciones se validan mediante código contra las restricciones oficiales.

---

## 📚 Uso de la galería

| Acción | Cómo |
|---|---|
| **Buscar** | Cuadro de búsqueda en la parte superior (debounce de 300 ms; coincide con prompt / prompt reescrito / palabras clave) |
| **Filtrar** | Por modelo y por rango de tiempo |
| **Selección múltiple** | Casilla en la tarjeta, o mediante la capa superpuesta al pasar el cursor |
| **Eliminación por lotes** | Selecciona elementos → aparece la barra de acciones por lotes en la parte superior |
| **Inspeccionar una imagen** | Capa superpuesta al pasar el cursor, o abre el panel de detalle |
| **Generar de nuevo** | 🔁 en el panel de detalle — vuelve al generador y rellena el prompt y los parámetros |
| **Copiar prompt** | 📋 en el panel de detalle |
| **Copiar imagen** | 🖼 en el panel de detalle (si el navegador no tiene `ClipboardItem`, copia la ruta local como alternativa) |

---

## ⚠️ Limitaciones conocidas y hoja de ruta

### Limitaciones (impuestas por la API de Tencent o por el host de DSH)

| Elemento | Detalle |
|---|---|
| **Duración de la URL remota de la imagen** | Solo 12 horas — este plugin descarga cada imagen al disco de inmediato, así que las entradas de la galería son permanentes |
| **Tamaño de la imagen de referencia** | v3.5 ≤ 20 MB cada una; v3.0 ≤ 10 MB cada una |
| **Cantidad de imágenes de referencia** | v3.5 ≤ 20; v3.0 ≤ 3 |
| **Pie de marca de agua** | ≤ 16 caracteres UTF-8 |
| **`generate_max_pixels` llega como máximo a 2K** | Las resoluciones superiores deben pasar por `size` (este plugin lo hace mediante el nivel de resolución) |
| **Edición multiturno** | Solo v3.5. El plugin guarda el `assembled_history` que devuelve el servidor, pero todavía no hay interfaz para la edición multiturno |
| **Los parámetros avanzados no se persisten** | Los interruptores de búsqueda externa, límite de área de referencia y reescritura se aplican **solo a la sesión actual** y se restablecen al reabrir el panel. Es deliberado — evita estado oculto que después es difícil de diagnosticar |

### Aún no implementado

| Función | Estado | Por qué |
|---|---|---|
| **Botón automático "abrir galería" cuando mencionas la galería** | ❌ | Requiere escuchar los eventos de mensajes de la sesión e inyectar un botón de acción; no está conectado en la v1.0 |
| **Diálogo de exportar / guardar como** | ⚠️ esbozo | DSH todavía no expone un diálogo de "guardar como" a los plugins; la llamada devuelve un motivo explícito en lugar de fallar en silencio |
| **Compartir por WeChat / Feishu** | ⚠️ esbozo | DSH todavía no expone un canal de compartir por IM a los plugins |
| **Arrastrar una imagen a la conversación** | ❌ | Depende de que DSH exponga eventos de arrastre |
| **Interfaz de edición multiturno** | ❌ | La capa de datos está lista (`assembledHistory`); solo falta la interfaz |
| **Mercado oficial de plugins de DSH** | ❌ | Requiere la revisión del equipo de DSH |
| **UI del panel en varios idiomas** | ❌ | La UI dentro del panel es actualmente **solo en chino**; únicamente el título y la descripción del plugin están localizados (EN/ZH). Estos README traducidos son una solución provisional |

Los comentarios y pull requests son muy bienvenidos — abre un [Issue](../../issues).

---

## 🛠 Desarrollo

### Estructura del proyecto

```
dsh-plugin-hunyuan-image/
├── package.json              # manifiesto del plugin (dsh.bundle.patch + dsh.client)
├── cordis.patch.yml          # patch del cargador Cordis: declara la fila del plugin host
├── icon.svg / locale/        # metadatos de visualización (icono + título y descripción EN/ZH)
├── scripts/
│   ├── build-client.mjs      # empaqueta TS/TSX al formato de tabla de módulos del cliente DSH
│   └── smoke-activate.mjs    # prueba de humo de activación (ejecútala antes de reiniciar DSH)
├── src/
│   ├── server.ts             # ★ Mitad Host: entrada del plugin Cordis (apply + inject)
│   ├── client.ts             # ★ Mitad Client: registra el dock del compositor + la capa del panel
│   ├── types.ts              # contratos de datos entre módulos
│   ├── size-presets.ts       # nivel de resolución + relación de aspecto → "WxH" (con comprobación de restricciones)
│   ├── host/
│   │   └── routes.ts         # endpoints HTTP del host: /hunyuan/api/* y /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # envoltorio fetch cliente → host
│   │   ├── config-client.ts  # caché de configuración + actualizaciones
│   │   ├── bus.ts            # bus de eventos (selector de carpetas, selector de archivos, …)
│   │   └── file-url.ts       # ruta local de imagen → URL cargable
│   ├── services/
│   │   ├── config.ts         # persistencia de configuración (JSON, escritura atómica)
│   │   ├── storage.ts        # gestión de archivos locales + descarga de imágenes (la ruta sigue la configuración en vivo)
│   │   ├── hunyuan.ts        # pasarela de la API de Hunyuan (v3 + v3.5)
│   │   └── gallery.ts        # galería JSON (índice en memoria + escritura atómica, sin dependencias nativas)
│   └── slots/
│       ├── generator-panel.tsx   # panel de generación (pestaña "Generar" de la capa)
│       ├── gallery-panel.tsx     # panel de galería (pestaña "Galería" de la capa)
│       └── settings-panel.tsx    # panel de ajustes (pestaña "Ajustes" de la capa)
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### Notas de arquitectura

- **Dos entradas**: `dist/server.js` es la mitad Host (proceso Node.js) y `dist/client.js` es la
  mitad Client (navegador). Esta última debe estar en formato `window.__ModuleLoader__.load({id, factory})`,
  generado por `scripts/build-client.mjs` mediante esbuild; JSX se compila forzosamente a
  `React.createElement` porque la tabla de módulos de DSH proporciona `React` pero **no** `react/jsx-runtime`.
- **Punto de entrada de la interfaz**: el cliente registra un único slot `conversation.composer.dock` (un botón).
  Al hacer clic en él se abre una capa con tres pestañas: Generar / Galería / Ajustes.
- **Cliente ↔ host**: el cliente llama al host mediante `fetch('/hunyuan/api/<method>')`; las imágenes se
  sirven de vuelta por `/hunyuan/file?path=<ruta absoluta>` (restringido a archivos dentro de la
  carpeta de guardado configurada, para evitar el path traversal).
- **Cero dependencias nativas**: la galería es un archivo JSON en lugar de SQLite, así que carga bien bajo
  las restricciones de firma de código / runtime reforzado de la app de DSH, y no necesita recompilarse en
  Windows ni en Linux.

### Compilación local

```bash
pnpm install
pnpm build         # tsc → dist/ (host), esbuild → dist/client.js (cliente)
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### Modo de depuración

Inicia DSH con `--plugin-debug=hunyuan-image` para obtener registros detallados.

---

## 🤝 Contribuir

Las issues y los pull requests son bienvenidos.

- 🐛 ¿Encontraste un bug? → [abre un informe de bug](../../issues/new?template=bug.md)
- 💡 ¿Tienes una idea? → [abre una solicitud de función](../../issues/new?template=feature.md)
- 🔧 ¿Envías código? → fork, rama, PR

---

## 📄 Licencia

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 Agradecimientos

- Al equipo de Tencent Hunyuan por la API
- Al equipo de DSH por la plataforma de plugins
- A todas las personas que abren issues y ayudan a mejorar este plugin
