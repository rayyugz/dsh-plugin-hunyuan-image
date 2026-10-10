# Tencent Hunyuan 이미지 생성 · DSH 네이티브 플러그인

Languages: [English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · **한국어** · [Português](README.pt.md) · [Español](README.es.md) · [Русский](README.ru.md)

> Tencent Hunyuan의 **Hy-Image-3.5-preview**와 **Hy-Image-3.0**을
> [DSH (DeepSeek Harness)](https://deepseek.com)로 가져옵니다 — 생성 패널, 로컬 갤러리,
> 공식 2단계 크기 선택기, 배치 생성을 제공합니다.
> **네이티브 의존성 제로. macOS, Windows, Linux에서 실행됩니다.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node: ≥20](https://img.shields.io/badge/Node-%E2%89%A520-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#)
[![CI](https://github.com/rayyugz/dsh-plugin-hunyuan-image/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

---

## ✨ 기능

- **두 가지 모델**
  - `hy-image-v3.5-preview` — Chat/Messages 프로토콜, 멀티모달 입력, 멀티턴 편집,
    사고 사슬(chain-of-thought) 재작성 지원, 최대 **4K(4096×4096)** 출력
  - `hy-image-v3` — 클래식 텍스트-투-이미지, 프롬프트 재작성과 공식 37종 프리셋 크기
- **공식 2단계 크기 선택기** — **해상도 등급 × 화면 비율**로, Tencent TokenHub 웹 콘솔과
  동일한 인터랙션입니다. 플러그인은 선택한 값을 API가 기대하는 `WxH` 문자열로 변환하고,
  공식 제약 조건을 충족하도록 보장합니다
  (v3.5: 변 길이 [256, 8192], 면적 ≤ 16,777,216; v3.0: 변 길이 [512, 2048], 면적 ≤ 1,048,576).
  UI에는 실제로 전송될 정확한 크기가 표시됩니다.
- **배치 생성** — 한 번의 요청으로 **1 / 2 / 4장**을 생성하며(병렬로 발행) 결과는
  `1/4` 순번 배지와 함께 한 장씩 표시됩니다. 일부 실패도 명시적으로 보고됩니다.
- **로컬 갤러리**
  - 생성에 성공할 때마다 **자동으로 저장**됩니다 (순수 JS JSON 저장소 — SQLite도, 네이티브 모듈도 사용하지 않습니다)
  - **썸네일 그리드**와 리스트 보기
  - **키워드 검색**(프롬프트와 재작성된 프롬프트 모두 일치)과 모델·시간 범위 필터
  - 전체 프롬프트, 모델, 크기, 시각, 로컬 경로를 보여주는 **상세 드로어**
  - **🔁 다시 생성** — 클릭 한 번으로 원래 프롬프트와 파라미터를 다시 채웁니다
  - 다중 선택 **일괄 삭제**(로컬 파일도 함께 삭제), 프롬프트 복사, 이미지 복사
- **출력 폴더 사용자 지정** — 기본값은 `~/Pictures/DSH-Hunyuan-Image`이지만 원하는 위치를
  지정할 수 있습니다(시스템 드라이브가 아닌 곳을 권장합니다). **"Choose…"**를 클릭하면
  OS 기본 폴더 선택기가 열립니다. **변경 사항은 즉시 적용되며 플러그인 재시작이 필요 없습니다.**
  파일은 `<폴더>/<YYYY-MM>/` 아래에 월별로 분류 저장되어 수천 개의 파일이 한 디렉터리에
  쌓이는 것을 방지합니다.
- **공식 고급 파라미터** (의도적으로 세션 범위에서만 적용 — [로드맵](#-알려진-제한-사항-및-로드맵) 참조)

  | 파라미터 | 적용 대상 | 설명 |
  |---|---|---|
  | 시드 `seed` | 양쪽 모두 | 동일한 결과 재현 |
  | 워터마크 각주 `footnote` | 양쪽 모두 | ≤ 16자, 이미지 오른쪽 아래 모서리에 렌더링 |
  | 외부 검색 증강 `use_search_tool` | v3.5 | 그리기 전에 모델이 웹을 검색하도록 허용 |
  | 참조 이미지 면적 상한 `resize_max_pixels` | v3.5 | 대형(4K/6K) 참조 이미지의 토큰 비용 제한 |
  | 프롬프트 자동 재작성 `revise` | v3.0 | 약 11초 추가, 기본 활성화 권장 |

- **참조 이미지** — 디스크에서 업로드하거나(data URL로 변환) 공개 URL을 전달할 수 있습니다.
  v3.5는 최대 20장(장당 ≤ 20 MB), v3.0은 최대 3장(장당 ≤ 10 MB)을 허용합니다.
- **모델이 직접 호출 가능** — 플러그인이 **`hunyuan_generate_image`** 도구를 등록하므로,
  대화에서 "고양이 그려줘"라고 말하기만 하면 모델이 이를 호출합니다.
- **영구 보존되는 이미지** — Tencent의 원격 URL은 **12시간** 후 만료됩니다. 플러그인은 생성된
  모든 이미지를 즉시 디스크로 다운로드하므로 갤러리 항목이 깨지지 않습니다.

> 📌 구현되지 않은 기능은
> [알려진 제한 사항 및 로드맵](#-알려진-제한-사항-및-로드맵)에 솔직하게 정리했습니다.
> 이 README는 현재 버전이 실제로 수행하는 것만 설명합니다.

---

## 📦 설치

### 옵션 1 — Release에서 설치 (권장, 빌드 단계 없음)

1. [**Releases**](../../releases) 페이지에서 `dsh-plugin-hunyuan-image-1.0.0.tgz`를 다운로드합니다.
2. 영구 폴더(예: `~/dsh-plugins/`)에 압축을 풉니다:

   ```bash
   mkdir -p ~/dsh-plugins
   tar -xzf dsh-plugin-hunyuan-image-1.0.0.tgz -C ~/dsh-plugins
   ```

3. DSH 채팅에서 어시스턴트에게 말합니다:

   > `~/dsh-plugins/package`를 DSH 플러그인으로 설치해 주세요 (`plugin_manager`의 `install_bundle` 사용).

4. DSH를 재시작합니다.

> 단계별 재설치 / 새 머신 안내: [**INSTALL.md**](INSTALL.md)
> ([简体中文](INSTALL.zh-CN.md)로도 제공됩니다).

### 옵션 2 — 소스에서 빌드 (개발자)

**Node ≥ 20**과 **pnpm**이 필요합니다.

```bash
git clone https://github.com/rayyugz/dsh-plugin-hunyuan-image.git
cd dsh-plugin-hunyuan-image

pnpm install
pnpm build                        # host 반쪽 컴파일 + client 반쪽 번들링
node scripts/smoke-activate.mjs   # 스모크 테스트 — "全部通过"가 출력되어야 함

# DSH profile에 링크
# macOS / Linux:
ln -s "$(pwd)" ~/.dsh/profiles/desktop/node_modules/dsh-plugin-hunyuan-image
# Windows (PowerShell, 관리자):
# New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-plugin-hunyuan-image" -Target "$PWD"
```

그런 다음 profile의 `package.json`에 플러그인 이름을 추가하고(`dependencies`와
`dsh.profile.bundles` 두 곳 모두) DSH를 재시작합니다.

---

## ⚙️ 설정

### 1. API Key 발급

1. [Tencent Cloud](https://cloud.tencent.com)에 가입 / 로그인합니다
2. [TokenHub 서비스](https://console.cloud.tencent.com/tokenhub)를 활성화합니다
3. [API Key 페이지](https://console.cloud.tencent.com/tokenhub/apikey)에서 Key를 생성합니다 — `sk-...` 형태입니다
4. [온라인 추론 → 비전 모델](https://console.cloud.tencent.com/tokenhub/inference?regionId=1&serviceType=VISION)에서
   `hy-image-v3.5-preview`와 `hy-image-v3`의 **종량제(pay-as-you-go)** 결제를 활성화합니다

### 2. 플러그인 설정 입력

플러그인 패널(작성기 아래의 **🖼 Hunyuan Image** 버튼)을 열고 → **Settings** 탭으로 이동합니다:

| 필드 | 설명 | 기본값 |
|---|---|---|
| **API Key** | 위에서 생성한 Key | — |
| **Output folder** | 원하는 위치, 시스템 드라이브가 아닌 곳을 권장 | `~/Pictures/DSH-Hunyuan-Image` |
| **Default model** | `hy-image-v3.5-preview` 또는 `hy-image-v3` | v3.5-preview |
| **Default resolution** | [크기](#-크기) 참조 | `1K` |
| **Default aspect ratio** | [크기](#-크기) 참조 | `1:1` |
| **Watermark footnote** | ≤ 16자, 오른쪽 아래 모서리 | 비어 있음 |

**Save**를 클릭한 다음 **🔌 Test connection**을 눌러 Key가 작동하는지 확인합니다.

> ⚠️ **참고**: 이미지는 **월별 하위 폴더** 아래에 저장됩니다. 예:
> `AI-images/2026-10/1791629683045-xxxx.png` — 폴더 루트에 직접 저장되지 않습니다.

---

## 🖼 크기

플러그인은 공식 TokenHub 선택기를 그대로 따릅니다: **해상도 등급**과 **화면 비율**을 선택합니다.

### Hy-Image-3.5-preview

| 등급 | 화면 비율 | 비고 |
|---|---|---|
| `1K` / `1.5K` / `2K` | `21:9` `16:9` `4:3` `1:1` `2:3` `3:2` `3:4` `9:16` | 면적 ≈ 1M / 2.36M / 4.19M px |
| `4K` | 동일 | 면적 ≤ 16,777,216 px, 예: 16:9 → `5461x3072` |
| `Auto` | — | `size`를 전송하지 않으며 모델이 결정 |

### Hy-Image-3.0

| 등급 | 화면 비율 | 비고 |
|---|---|---|
| `720P` / `1K` | `1:1` `3:4` `4:3` `9:16` `16:9` `3:5` `5:3` | 변 길이가 [512, 2048]이고 면적 ≤ 1,048,576이어야 함 |
| `Auto` | — | 모델이 공식 37종 프리셋 중에서 선택 |

**대략적인 크기 참고** (실제로 전송되는 값):

```
v3.5  1K   16:9 = 1365x768      1:1 = 1024x1024
      2K   16:9 = 2731x1536     1:1 = 2048x2048
      4K   16:9 = 5461x3072     1:1 = 4096x4096
v3.0  720P 16:9 = 1280x720      1:1 = 960x960
      1K   16:9 = 1365x768      1:1 = 1024x1024
```

62가지 조합 모두 공식 제약 조건에 대해 프로그래밍 방식으로 검증됩니다.

---

## 📚 갤러리 사용

| 동작 | 방법 |
|---|---|
| **검색** | 상단 검색 상자(300 ms 디바운스, 프롬프트 / 재작성된 프롬프트 / 키워드 일치) |
| **필터** | 모델별, 시간 범위별 |
| **다중 선택** | 카드의 체크박스 또는 호버 오버레이 사용 |
| **일괄 삭제** | 항목을 선택하면 상단에 일괄 작업 표시줄이 나타남 |
| **이미지 한 장 자세히 보기** | 호버 오버레이 또는 상세 드로어 열기 |
| **다시 생성** | 상세 드로어의 🔁 — 생성기로 되돌아가 프롬프트와 파라미터를 다시 채움 |
| **프롬프트 복사** | 상세 드로어의 📋 |
| **이미지 복사** | 상세 드로어의 🖼 (브라우저가 `ClipboardItem`을 지원하지 않으면 로컬 경로 복사로 대체됨) |

---

## ⚠️ 알려진 제한 사항 및 로드맵

### 제한 사항 (Tencent API 또는 DSH 호스트에 의해 부과됨)

| 항목 | 세부 내용 |
|---|---|
| **원격 이미지 URL 유효 기간** | 12시간에 불과 — 이 플러그인은 모든 이미지를 즉시 디스크로 다운로드하므로 갤러리 항목은 영구적입니다 |
| **참조 이미지 크기** | v3.5 장당 ≤ 20 MB, v3.0 장당 ≤ 10 MB |
| **참조 이미지 개수** | v3.5 ≤ 20, v3.0 ≤ 3 |
| **워터마크 각주** | ≤ 16 UTF-8 문자 |
| **`generate_max_pixels`는 2K까지만** | 더 높은 해상도는 반드시 `size`를 통해야 합니다 (이 플러그인은 해상도 등급을 통해 이를 처리합니다) |
| **멀티턴 편집** | v3.5 전용입니다. 플러그인은 서버가 반환한 `assembled_history`를 저장하지만, 멀티턴 편집 UI는 아직 없습니다 |
| **고급 파라미터는 저장되지 않음** | 외부 검색, 참조 이미지 면적 상한, 자동 재작성 토글은 **현재 세션에만** 적용되며 패널을 다시 열면 초기화됩니다. 이는 의도된 설계로, 나중에 진단하기 어려운 숨은 상태를 남기지 않기 위한 것입니다 |

### 아직 구현되지 않음

| 기능 | 상태 | 이유 |
|---|---|---|
| **갤러리를 언급하면 자동으로 "갤러리 열기" 버튼 표시** | ❌ | 세션 메시지 이벤트를 수신해 액션 버튼을 주입해야 하며, v1.0에는 연결되지 않았습니다 |
| **내보내기 / 다른 이름으로 저장 대화상자** | ⚠️ 스텁 | DSH가 아직 플러그인에 "다른 이름으로 저장" 대화상자를 노출하지 않습니다. 호출은 조용히 실패하지 않고 명시적인 이유를 반환합니다 |
| **WeChat / Feishu 공유** | ⚠️ 스텁 | DSH가 아직 플러그인에 IM 공유 채널을 노출하지 않습니다 |
| **대화로 이미지 드래그** | ❌ | DSH가 드래그 이벤트를 노출하는지에 의존합니다 |
| **멀티턴 편집 UI** | ❌ | 데이터 계층은 준비되어 있고(`assembledHistory`), UI만 없습니다 |
| **DSH 공식 플러그인 마켓** | ❌ | DSH 팀의 심사가 필요합니다 |
| **패널 UI 다국어** | ❌ | 패널 내부 UI는 현재 **중국어만** 지원합니다. 플러그인 제목과 설명은 현지화되어 있지만(EN/ZH), 패널 안의 레이블은 아직 국제화되지 않았습니다. 이 다국어 README는 임시 방편입니다 |

피드백과 풀 리퀘스트를 언제나 환영합니다 — [Issue](../../issues)를 열어 주세요.

---

## 🛠 개발

### 프로젝트 구조

```
dsh-plugin-hunyuan-image/
├── package.json              # 플러그인 manifest (dsh.bundle.patch + dsh.client)
├── cordis.patch.yml          # Cordis 로더 patch: host 플러그인 행 선언
├── icon.svg / locale/        # 표시 메타데이터 (아이콘 + EN/ZH 제목 및 설명)
├── scripts/
│   ├── build-client.mjs      # TS/TSX를 DSH 클라이언트 모듈 테이블 형식으로 번들링
│   └── smoke-activate.mjs    # 활성화 스모크 테스트 (DSH 재시작 전에 실행)
├── src/
│   ├── server.ts             # ★ Host 반쪽: Cordis 플러그인 엔트리 (apply + inject)
│   ├── client.ts             # ★ Client 반쪽: composer dock + 패널 오버레이 등록
│   ├── types.ts              # 모듈 간 데이터 계약
│   ├── size-presets.ts       # 해상도 등급 + 화면 비율 → "WxH" (제약 조건 검사 포함)
│   ├── host/
│   │   └── routes.ts         # host HTTP 엔드포인트: /hunyuan/api/* 와 /hunyuan/file
│   ├── client-services/
│   │   ├── rpc.ts            # client → host fetch 래퍼
│   │   ├── config-client.ts  # 설정 캐시 + 업데이트
│   │   ├── bus.ts            # 이벤트 버스 (폴더 선택, 파일 선택 등)
│   │   └── file-url.ts       # 로컬 이미지 경로 → 로드 가능한 URL
│   ├── services/
│   │   ├── config.ts         # 설정 영속화 (JSON, 원자적 쓰기)
│   │   ├── storage.ts        # 로컬 파일 관리 + 이미지 다운로드 (경로는 설정을 실시간으로 따름)
│   │   ├── hunyuan.ts        # Hunyuan API 게이트웨이 (v3 + v3.5)
│   │   └── gallery.ts        # JSON 갤러리 (메모리 인덱스 + 원자적 쓰기, 네이티브 의존성 없음)
│   └── slots/
│       ├── generator-panel.tsx   # 생성 패널 (오버레이 "Generate" 탭)
│       ├── gallery-panel.tsx     # 갤러리 패널 (오버레이 "Gallery" 탭)
│       └── settings-panel.tsx    # 설정 패널 (오버레이 "Settings" 탭)
├── README.md + 7 translations (.zh-CN · .zh-TW · .ja · .ko · .pt · .es · .ru)
├── INSTALL.md / INSTALL.zh-CN.md
└── LICENSE
```

### 아키텍처 노트

- **두 개의 엔트리**: `dist/server.js`는 Host 반쪽(Node.js 프로세스)이고 `dist/client.js`는
  Client 반쪽(브라우저)입니다. 후자는 `window.__ModuleLoader__.load({id, factory})` 형식이어야 하며,
  `scripts/build-client.mjs`가 esbuild로 생성합니다. JSX는 `React.createElement`로 강제
  컴파일되는데, DSH 모듈 테이블은 `React`는 제공하지만 `react/jsx-runtime`은 제공하지 **않기** 때문입니다.
- **UI 진입점**: 클라이언트는 `conversation.composer.dock` 슬롯 하나(버튼)를 등록합니다.
  이를 클릭하면 Generate / Gallery / Settings 세 개의 탭이 있는 오버레이가 열립니다.
- **Client ↔ host**: 클라이언트는 `fetch('/hunyuan/api/<method>')`를 통해 host를 호출하고,
  이미지는 `/hunyuan/file?path=<절대 경로>`를 통해 전송됩니다(경로 순회를 방지하기 위해
  설정된 출력 폴더 내부의 파일로 제한됩니다).
- **네이티브 의존성 제로**: 갤러리는 SQLite가 아닌 JSON 파일이므로 DSH 앱의 macOS 코드 서명 /
  강화 런타임(hardened runtime) 제약 아래에서도 문제없이 로드되며, Windows나 Linux에서
  재빌드가 필요하지 않습니다.

### 로컬 빌드

```bash
pnpm install
pnpm build         # tsc → dist/ (host), esbuild → dist/client.js (client)
pnpm typecheck     # tsc --noEmit
node scripts/smoke-activate.mjs
```

### 디버그 모드

DSH를 `--plugin-debug=hunyuan-image`와 함께 시작하면 상세 로그가 출력됩니다.

---

## 🤝 기여

이슈와 풀 리퀘스트를 환영합니다.

- 🐛 버그를 발견했다면 → [버그 리포트 열기](../../issues/new?template=bug.md)
- 💡 아이디어가 있다면 → [기능 요청 열기](../../issues/new?template=feature.md)
- 🔧 코드를 보낸다면 → 포크, 브랜치, PR

---

## 📄 라이선스

MIT © [rayyugz](https://github.com/rayyugz)

---

## 🙏 감사의 글

- API를 제공한 Tencent Hunyuan 팀
- 플러그인 플랫폼을 제공한 DSH 팀
- 이슈를 남기고 이 플러그인 개선을 도와주시는 모든 분
