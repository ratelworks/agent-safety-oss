/**
 * agent-safety-oss/engine — 호스트 저장 주입 모드 공개 진입점
 *
 * 단독 사용(MCP 서버·CLI·브라우저 폼)은 이 모듈이 필요 없다. 다른 서비스 안에 엔진을 넣을 때만 쓴다.
 */
export {
  createSafetyEngine,
  getSafetyEngineManifest,
  SAFETY_ENGINE_ID,
  SAFETY_ENGINE_CONTRACT_VERSION,
  type SafetyEngine,
  type SafetyEngineOptions,
  type SafetyEngineManifest,
  type SafetyToolInfo,
  type SafetyCallResult,
} from "./create-engine.js";
export {
  SAFETY_STORAGE_KINDS,
  COMPANY_PROFILE_ID,
  createMemorySafetyStorage,
  type SafetyStorage,
  type SafetyStorageKind,
  type SafetyStorageRecord,
  type SafetyFileIn,
  type SafetyFileOut,
  type SafetyFileReader,
  type SafetyClock,
  type SafetyTraceEvent,
  type SafetyScope,
  type SafetyWriteRef,
} from "./storage.js";
export { SafetyEngineError, HOST_STORAGE_LABEL, HOST_FILE_URI_PREFIX, type SafetyEngineErrorCode } from "./host-context.js";
export {
  TOOL_TRAITS,
  type SafetyToolTraits,
  type SafetyToolAccess,
  type SafetyToolStorage,
  type SafetyHumanRequirement,
  type SafetyHumanKind,
} from "./tool-catalog.js";
