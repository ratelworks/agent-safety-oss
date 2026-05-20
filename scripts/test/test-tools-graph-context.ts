#!/usr/bin/env tsx
import { listKrasMethodsTool } from "../../build/tools/list-kras-methods.js";
import { getKrasMethodTool } from "../../build/tools/get-kras-method.js";
import { chooseAssessmentMethodTool } from "../../build/tools/choose-assessment-method.js";

async function main() {
  console.log("════════════════════════════════════════");
  console.log("KOSHA 도구 graphContext 응답 검증");
  console.log("════════════════════════════════════════\n");

  console.log("─── 1. list_kras_methods ───");
  const r1: any = await listKrasMethodsTool.handler({});
  const sc1 = r1.structuredContent;
  console.log("methods 개수:", sc1.methods.length);
  console.log("각 method.iri:");
  for (const m of sc1.methods) console.log(`  · ${m.code.padEnd(28)} → ${m.iri}`);
  console.log("graphContext:");
  console.log("  relatedNodes:", sc1.graphContext.relatedNodes.length, "개");
  console.log("  relatedSteps:", sc1.graphContext.relatedSteps);
  console.log("  riskMatrix:", sc1.graphContext.riskMatrix);
  console.log("  manuals:", sc1.graphContext.manuals);
  console.log("  legalBasis:", sc1.graphContext.legalBasis);
  console.log("");

  console.log("─── 2. get_kras_method({method: 'construction_continuous'}) ───");
  const r2: any = await getKrasMethodTool.handler({method: "construction_continuous"});
  const sc2 = r2.structuredContent;
  console.log("method.iri:", sc2.method?.iri);
  console.log("graphContext.methodNode:", sc2.graphContext.methodNode);
  console.log("graphContext.applicableActivities (10개):");
  for (const a of sc2.graphContext.applicableActivities) console.log(`  · ${a}`);
  console.log("graphContext.riskAssessmentDocs (5개):");
  for (const d of sc2.graphContext.riskAssessmentDocs) console.log(`  · ${d}`);
  console.log("");

  console.log("─── 3. choose_assessment_method({construction, medium, general}) ───");
  const r3: any = await chooseAssessmentMethodTool.handler({industry: "construction", scale: "medium", subject: "general"});
  const sc3 = r3.structuredContent;
  console.log("primary:", sc3.recommendation.primary);
  console.log("graphContext.primaryMethodIRI:", sc3.graphContext.primaryMethodIRI);
  console.log("graphContext.secondaryMethodIRIs:", sc3.graphContext.secondaryMethodIRIs);
  console.log("graphContext.riskMatrix:", sc3.graphContext.riskMatrix);
}
main().catch(console.error);
