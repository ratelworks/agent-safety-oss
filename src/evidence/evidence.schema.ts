import { z } from "zod";
import {
  BASIS_TYPES,
  LEGAL_WEIGHTS,
  EVIDENCE_SOURCES,
} from "../config/constants.js";

// 파일 최상단 상수 — SSoT 는 config/constants.ts
// 이 파일은 Zod 스키마 래퍼 역할만 한다. 상수 자체를 여기서 정의하지 말 것.
export { BASIS_TYPES, LEGAL_WEIGHTS, EVIDENCE_SOURCES };

// Zod z.enum 은 readonly [string, ...string[]] 형식을 기대하므로
// as const 배열을 spread 하지 않고 그대로 전달한다.
export const EvidenceItemSchema = z.object({
  basisType: z.enum(BASIS_TYPES),
  legalWeight: z.enum(LEGAL_WEIGHTS),
  title: z.string(),
  source: z.enum(EVIDENCE_SOURCES),
  url: z.string().url().optional(),
  reference: z.string().optional(),
  snippet: z.string().optional(),
  retrievedAt: z.string().optional(),
});

export type EvidenceItemT = z.infer<typeof EvidenceItemSchema>;

