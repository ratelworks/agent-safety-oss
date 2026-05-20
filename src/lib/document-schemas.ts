// 파일 최상단 상수 — 문서 유형별 법정/관행 스키마 정의
// LLM 이 Schema 를 받아 필드를 채워 문서 초안을 작성한다 (MCP 는 작성 안 함).

export type FieldRequirement = "mandatory" | "recommended" | "optional";

export interface SchemaField {
  name: string; // 필드명 (한국어)
  requirement: FieldRequirement;
  description: string; // 작성 가이드
  lawBasis?: string; // 법적 근거 (예: "산안법 §36")
  example?: string; // 예시 값
}

export interface SchemaSection {
  heading: string; // ## 헤딩
  description?: string;
  fields: SchemaField[];
}

export interface DocumentSchema {
  docType: string;
  docTypeKo: string;
  purpose: string;
  legalObligation?: string; // 법정 의무 조문
  frequency: string; // 작성 빈도
  primaryAuthor: string; // 작성 주체
  retention: string; // 보존 기간
  sections: SchemaSection[];
  signatureBlock?: string[]; // 서명란 필요 역할
  relatedLaws: string[]; // 관련 법령 조문 (get_safety_law_article 로 조회 가능한 ref)
  relatedTools: string[]; // 함께 호출하면 좋은 Tool
  notes?: string[];
}

// Schema → MD 직렬화 헬퍼
export function renderSchemaAsMarkdown(schema: DocumentSchema): string {
  const lines: string[] = [];

  lines.push(`# ${schema.docTypeKo} 작성 스키마`);
  lines.push("");
  lines.push(`> **목적**: ${schema.purpose}`);
  if (schema.legalObligation) {
    lines.push(`> **법적 의무**: ${schema.legalObligation}`);
  }
  lines.push(`> **작성 주체**: ${schema.primaryAuthor}`);
  lines.push(`> **작성 빈도**: ${schema.frequency}`);
  lines.push(`> **보존 기간**: ${schema.retention}`);
  lines.push("");
  lines.push(
    "이 스키마는 LLM 이 문서 초안을 작성할 때 **반드시 포함해야 할 필드**와 **권장 필드**를 명시합니다. 문서는 LLM 이 작성하며, 본 스키마는 가드레일입니다.",
  );
  lines.push("");

  // 각 섹션
  for (const section of schema.sections) {
    lines.push(`## ${section.heading}`);
    if (section.description) {
      lines.push("");
      lines.push(section.description);
    }
    lines.push("");

    if (section.fields.length > 0) {
      lines.push("| 필드 | 필수여부 | 설명 | 법적 근거 |");
      lines.push("|------|:------:|------|----------|");
      for (const f of section.fields) {
        const badge =
          f.requirement === "mandatory"
            ? "🔴 필수"
            : f.requirement === "recommended"
              ? "🟡 권장"
              : "⚪ 선택";
        const desc = f.example
          ? `${f.description} (예: ${f.example})`
          : f.description;
        lines.push(
          `| ${f.name} | ${badge} | ${desc} | ${f.lawBasis ?? "—"} |`,
        );
      }
      lines.push("");
    }
  }

  // 서명란
  if (schema.signatureBlock && schema.signatureBlock.length > 0) {
    lines.push("## 서명란");
    lines.push("");
    lines.push("| 구분 | 성명 | 서명 | 일자 |");
    lines.push("|:---:|:---:|:---:|:---:|");
    for (const role of schema.signatureBlock) {
      lines.push(`| ${role} |  |  |  |`);
    }
    lines.push("");
  }

  // 관련 법령
  if (schema.relatedLaws.length > 0) {
    lines.push("## 관련 법령·고시");
    lines.push("");
    for (const ref of schema.relatedLaws) {
      lines.push(`- ${ref} — \`get_safety_law_article(ref="${ref}")\` 로 원문 조회`);
    }
    lines.push("");
  }

  // 관련 Tool (`//` 접두 라인은 주석으로 취급해 Tool 호출 가이드가 아닌 일반 노트로 렌더)
  if (schema.relatedTools.length > 0) {
    lines.push("## 작성 시 함께 호출할 Tool");
    lines.push("");
    for (const tool of schema.relatedTools) {
      if (tool.trim().startsWith("//")) {
        lines.push(`> ${tool.replace(/^\/\/\s*/, "")}`);
      } else {
        lines.push(`- \`${tool}\``);
      }
    }
    lines.push("");
  }

  // 주의사항
  if (schema.notes && schema.notes.length > 0) {
    lines.push("## 작성 시 주의사항");
    lines.push("");
    for (const note of schema.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("**LLM 지침**: 위 스키마의 🔴 필수 필드는 반드시 채우고, 🟡 권장 필드는 정보가 있을 때 포함. 각 필드의 법적 근거는 `get_safety_law_article` 로 원문을 받아 인용하세요. 작성 완료 후 `validate_*_draft` Tool 로 누락 체크.");

  return lines.join("\n");
}
