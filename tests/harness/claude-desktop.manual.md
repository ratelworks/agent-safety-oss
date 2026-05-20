# Claude Desktop 수동 하네스 검증

## 목적

PLAN §0.5 No-Lock-In Principle 검증용 수동 절차다. Claude Desktop에서 `agent-safety-oss`를 로컬 MCP 서버로 등록하고, 안전관리자 실무 시나리오가 특정 모델·하네스에 잠기지 않고 동작하는지 확인한다.

참고:
- Claude Desktop 로컬 MCP / Desktop Extensions 안내: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- Claude custom connector 문서의 로컬 `claude_desktop_config.json` 구분: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

## 사전 조건

- 저장소에서 `npm install`과 `npm run build`가 완료되어야 한다.
- 수동 검증자는 현장 안전관리자 역할로 프롬프트를 입력한다.
- 로컬 검증은 원격 Connector가 아니라 Claude Desktop 로컬 MCP 설정을 사용한다.

## 등록 절차

1. Claude Desktop을 종료한다.
2. `claude_desktop_config.json`을 연다.
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. 다음 항목을 `mcpServers` 아래에 추가한다.

```json
{
  "mcpServers": {
    "agent-safety-oss": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/agent-safety-oss/build/cli.js", "serve"]
    }
  }
}
```

4. Claude Desktop을 다시 시작한다.
5. 새 대화에서 `+` 버튼 또는 Connectors/Developer 설정 화면을 열어 `agent-safety-oss` 연결 상태와 도구 노출을 확인한다.
6. 최소 확인값:
   - `tools/list` 상당 화면에서 70개 도구가 보여야 한다.
   - Resource `safety://skeleton/tbox`, `safety://skeleton/instances`를 선택 또는 참조할 수 있어야 한다.

## 수동 검증 시나리오 5개

각 시나리오는 새 대화 또는 컨텍스트 초기화 후 실행한다. Claude가 관련 MCP 도구 또는 Resource를 실제로 사용했는지 도구 호출 로그로 확인한다.

| 번호 | 시나리오 | 사용자 프롬프트 | 기대 MCP 사용 |
|---:|---|---|---|
| 1 | TBM 회의록 작성 | `오늘 4층 발코니 거푸집 양중 작업 TBM 회의록 초안을 작성해줘. 현장명은 황룡건설 삼성동 현장, 참석자는 8명.` | `get_safety_document_guide`, `get_tbm_schema`, `assemble_doc_context`, 필요 시 `generate_safety_document` |
| 2 | 굴착 작업계획서 | `깊이 2.5m 굴착 작업계획서 작성에 필요한 조사 항목, 위험요인, 통제대책, 법적 근거를 정리해줘.` | `get_work_plan_schema`, `assemble_doc_context`, `query_legal_basis`, `search_kosha_archive` 또는 Resource |
| 3 | 위험성평가 | `소규모 건설현장 월간 위험성평가를 준비하려고 해. KRAS 방법을 추천하고 거푸집 양중 작업 위험성평가 초안을 만들어줘.` | `choose_assessment_method`, `get_risk_assessment_schema`, `analyze_construction_work_risks` |
| 4 | 작업허가서 | `내일 지하 PIT 용접 작업이 있어. 화기작업 허가서에 필요한 입력값과 승인 전 점검항목을 정리해줘.` | `get_work_permit_schema`, `get_safety_document_guide`, `query_applicability` |
| 5 | 법적 근거 검증 | `방금 만든 TBM/작업계획서 초안의 법적 근거와 환각 가능성을 검토해줘. 없는 조문은 없다고 표시해줘.` | `review_safety_document`, `verify_safety_basis`, `query_legal_basis` |

## 합격 기준

- 5개 시나리오 모두 Claude Desktop에서 MCP 서버 연결 오류 없이 완료된다.
- 각 시나리오에서 최소 1개 이상의 `agent-safety-oss` 도구 또는 Resource가 실제 호출된다.
- TBM, 작업계획서, 위험성평가 출력은 문서 목적·필수 입력값·위험요인·통제대책·법적 근거를 구분한다.
- 법령·KOSHA Guide 인용은 MCP 결과에 근거해야 하며, 모르는 항목은 추정하지 않는다.
- `safety://skeleton/tbox`에는 6개 클래스(`WorkActivity`, `Hazard`, `ControlMeasure`, `KoshaGuide`, `Article`, `Action`)가 확인된다.
- `tools/list` 기준 70개 도구가 확인된다.

## 수동 sign-off

v1.0 release gate는 자동 항목 PASS와 별개로 아래 사용자 sign-off가 필요하다.

- 검증 일시:
- 검증자:
- Claude Desktop 버전:
- 서버 커밋:
- 결과: PASS / FAIL
- 실패 로그 또는 보류 사유:
