import denFaultsSql from "../../../sql/testing/den-faults.sql" with { type: "text" };
import diagnosticsSql from "../../../sql/testing/diagnostics.sql" with { type: "text" };
import { readSqlBundle } from "../infrastructure/sql-template";

const diagnostics = readSqlBundle(diagnosticsSql, {
  notifications: ["selectWholeRow"],
  rawRuntime: [
    "selectBindings",
    "insertUser",
    "updateUser",
    "lockUser",
    "setIsolation",
    "selectSettings",
  ],
  readSequence: ["advanceSequence", "incrementUnread"],
  scaleReadFreshSearchIndexFootprint: [
    "createDmSearchScaleDocuments",
    "createDmSearchScaleDocumentsPkey",
    "createDmSearchScaleDocumentsConversationCreatedIdx",
    "createDmSearchScaleDocumentsTermIdsIdx",
    "createDmSearchScaleTerms",
    "createDmSearchScaleTermsPkey",
    "createDmSearchScaleTermsConversationNormalizedIdx",
    "createDmSearchScaleTermsConversationIdIdx",
    "createDmSearchScaleTermsOrphanedIdx",
    "createDmSearchScaleTermsGramKeysIdx",
    "createDmSearchScaleReferences",
    "createDmSearchScaleReferencesPkey",
    "createDmSearchScaleReferencesConversationKindCreatedIdx",
    "indexSizes",
    "documentStats",
  ],
  scaleReadSearchIndexStorageSnapshot: ["indexBytes", "walBytes"],
  scaleSeedConversation: ["analyzeDocuments"],
} as const);

const denFaults = readSqlBundle(denFaultsSql, {
  inviteArmArchiveFault: [
    "createFaultSeq",
    "createFaultFn",
    "dropArchiveFaultTrigger",
    "createArchiveFaultTrigger",
  ],
  inviteArmRotationFault: [
    "createFaultSeq",
    "createFaultFn",
    "dropFaultTrigger",
    "createFaultTrigger",
  ],
  inviteDropFaultInjection: [
    "dropFaultTrigger",
    "dropArchiveFaultTrigger",
    "dropFaultFn",
    "dropFaultSeq",
  ],
  inviteFaultInjectionHits: ["selectFaultSeq"],
  membershipArmFaultInjection: [
    "createFaultSeq",
    "createFaultFn",
    "dropFaultTrigger",
    "createFaultTrigger",
  ],
  membershipDropFaultInjection: [
    "dropFaultTrigger",
    "dropFaultFn",
    "dropFaultSeq",
  ],
  membershipFaultInjectionHits: ["selectFaultSeq"],
} as const);

export const testSql = { ...diagnostics, ...denFaults } as const;
