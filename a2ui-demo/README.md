# A2UI 데모 (브라우저 뷰어)

`render_a2ui_form` 도구가 생성하는 A2UI v0.9 JSONL 출력을 브라우저에서 즉시 시각화하는 데모.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 뷰어 UI (jsonl 입력 textarea + 렌더링 영역) |
| `viewer.js` | A2UI v0.9 컴포넌트 (Column/Row/Card/Text/TextField/Button…) 렌더러 |
| `server.ts` | 로컬 HTTP 서버 (MCP 도구 호출 + jsonl 전달 — 옵션) |

## 빠른 실행 — 뷰어만

```bash
# 프로젝트 루트에서
open a2ui-demo/index.html
```

브라우저가 열리면 `mcp:a2ui:demo` npm 스크립트 출력을 복사해서 textarea 에 붙여넣고 렌더링 확인.

```bash
npm run mcp:a2ui:demo
```

## 빠른 실행 — 서버 모드

```bash
npx tsx a2ui-demo/server.ts
# → http://localhost:8765
```

서버 모드는 MCP 도구를 직접 호출해서 a2ui JSONL 을 브라우저로 푸시. Cloud Run 백엔드(`agent-safety-oss`) 가 발급한 키 사용 가능.

## 주의

- 데모용. 프로덕션 UI 가 아님 (a2ui 명세 자체 한계 — UX 깊은 동작 불가, A2UI README 참조)
- 본 폴더는 npm 패키지 publish 시 포함 안 됨 (`package.json` files 배열에 미포함)
- 세션 storage 는 `.gitignore` 처리 — 로컬 시연 후 정리됨
