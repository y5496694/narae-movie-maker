# 나래 무비메이커 데스크톱 MCP 브리지

`narae-desktop-mcp-bridge`는 실행 중인 나래 무비메이커 데스크톱 앱에 MCP 클라이언트를 연결하는 로컬 전용 패키지입니다. 편집 요청은 앱의 타임라인과 실행 취소 기록에 반영됩니다.

이 패키지에는 `private: true`가 설정되어 있으며 npm이나 MCP Registry에 게시하지 않습니다. `server.json`은 로컬 실행 정보이며 공개 레지스트리 등록 문서가 아닙니다.

## 요구 사항

- 실행 중인 나래 무비메이커 데스크톱 앱과 켜진 MCP 연결
- Node.js 18 이상

GUI를 실행하지 않는 독립 MCP 엔진은 소스 루트의 나래 CLI를 사용하세요. 이 패키지는 데스크톱 앱으로 메시지를 전달하는 브리지입니다.

## 로컬 실행

소스 루트에서 도움말을 확인합니다.

```sh
node packages/mcp-bridge/bin/narae-desktop-mcp.mjs --help
```

MCP 클라이언트에는 실제 로컬 파일의 절대 경로를 지정하세요.

```sh
claude mcp add narae-desktop -- node "C:/path/to/packages/mcp-bridge/bin/narae-desktop-mcp.mjs"
codex mcp add narae-desktop -- node "C:/path/to/packages/mcp-bridge/bin/narae-desktop-mcp.mjs"
```

Claude Desktop, Cursor 등에서는 다음과 같이 설정합니다.

```json
{
  "mcpServers": {
    "narae-desktop": {
      "command": "node",
      "args": ["C:/path/to/packages/mcp-bridge/bin/narae-desktop-mcp.mjs"]
    }
  }
}
```

기존 로컬 설정의 `bin/cartcut-mcp.mjs` 경로는 새 실행 파일로 연결하는 호환 진입점으로 유지합니다. 공개 npm 패키지를 내려받는 명령은 사용하지 않습니다.

## 설정

| 환경 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `NARAE_MCP_TOKEN` | 나래 무비메이커 설정 파일에서 읽음 | 앱 오른쪽 아래 연결 메뉴에 표시되는 토큰 |
| `NARAE_MCP_URL` | `http://127.0.0.1:9827/mcp` | 데스크톱 앱의 MCP 주소 |

설정 파일의 `mcp_token` 키를 읽습니다.

- Windows: `%APPDATA%\narae-movie-maker\config.json`
- macOS: `~/Library/Application Support/narae-movie-maker/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/narae-movie-maker/config.json`

기존 로컬 설정과의 호환을 위해 `CARTCUT_MCP_TOKEN` 및 `CARTCUT_MCP_URL`을 대체 값으로 인식합니다. `NARAE_MCP_*` 값이 우선하며, 원본 CartCut의 설정 폴더를 자동으로 읽지는 않습니다.

## 연결 동작

앱이 재시작되면 다음 요청에서 새 세션을 열고 클라이언트에 도구 목록 갱신을 알립니다. 이미 실행되었을 수 있는 편집 요청은 자동으로 다시 보내지 않습니다. 연결 중단 오류를 받으면 현재 타임라인을 확인한 뒤 다시 요청하세요.

기본 주소는 이 컴퓨터의 루프백 주소입니다. `NARAE_MCP_URL`을 지정하면 그 주소로 연결합니다. 프로토콜은 stdout을 사용하고 진단 기록은 stderr에 씁니다.

`--version`은 버전을 표시합니다. 앱이 없다는 오류가 나면 나래 무비메이커를 실행하고 연결을 켜세요. 토큰이 거부되면 환경 변수의 오래된 값을 지우거나 현재 토큰으로 바꾸세요.

## 원본과 라이선스

[CartCut v0.6.1의 MCP 브리지](https://github.com/cartesiancs/cartcut/tree/main/packages/mcp-bridge)에서 파생했습니다. 원본 Copyright (c) 2025 cartesiancs 및 MIT 라이선스를 `LICENSE`와 `NOTICE.txt`에 보존합니다. 원본 프로젝트의 npm 범위나 MCP Registry 이름을 이 패키지의 배포 이름으로 사용하지 않습니다.
