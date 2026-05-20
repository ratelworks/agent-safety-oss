import type { z } from "zod";
import type { BasisType, LegalWeight } from "../config/constants.js";

// MCP Tool 응답 공통 모양 (@modelcontextprotocol/sdk 스펙과 호환)
export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
  // 구조화된 결과 — MCP SDK 는 object 형태만 허용
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}

// Tool 정의 — tool-registry에서 수집. handler 는 항상 unknown 을 받아
// 각 tool 파일 내부에서 zod parse 로 좁힌다 (generic variance 회피)
export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<McpToolResult> | McpToolResult;
}

// Evidence 단위 — 모든 안전관리 결론에 첨부 가능
export interface EvidenceItem {
  basisType: BasisType;
  legalWeight: LegalWeight;
  title: string;
  source: "KOSHA" | "DATA_GO_KR" | "LAW_MCP" | "INTERNAL";
  url?: string;
  reference?: string; // 법령 조문, 가이드 코드, 사례 ID 등
  snippet?: string;
  retrievedAt?: string; // ISO 8601
}

// 위험요인 표현
export interface Hazard {
  hazard: string;
  riskLevel: "high" | "medium" | "low";
  controls: string[];
  evidence: EvidenceItem[];
}
