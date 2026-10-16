import backfillsSql from "../../../sql/messages/backfills.sql" with { type: "text" };
import conversationChangesSql from "../../../sql/messages/conversation-changes.sql" with { type: "text" };
import conversationReadsSql from "../../../sql/messages/conversation-reads.sql" with { type: "text" };
import countRequestsSql from "../../../sql/messages/count-requests.sql" with { type: "text" };
import epochReadabilitySql from "../../../sql/messages/epoch-readability.sql" with { type: "text" };
import identityBackupRefreshSql from "../../../sql/messages/identity-backup-refresh.sql" with { type: "text" };
import messageHidesSql from "../../../sql/messages/message-hides.sql" with { type: "text" };
import messageMutationsSql from "../../../sql/messages/message-mutations.sql" with { type: "text" };
import searchCoverageSql from "../../../sql/messages/search-coverage.sql" with { type: "text" };
import searchDocumentsSql from "../../../sql/messages/search-documents.sql" with { type: "text" };
import searchOutboxSql from "../../../sql/messages/search-outbox.sql" with { type: "text" };
import searchReadersSql from "../../../sql/messages/search-readers.sql" with { type: "text" };
import unreadCountersSql from "../../../sql/messages/unread-counters.sql" with { type: "text" };
import { readSqlBundle } from "../infrastructure/sql-template";

const countRequests = readSqlBundle(countRequestsSql, {
  claimMessageSearchCountRequest: [
    "lease",
    "selected",
    "updateSearchCountRequests",
    "updateSearchCountRequests2",
  ],
  completeMessageSearchCountRequest: ["withSearchCountRequests"],
  expireStaleMessageSearchCounts: ["updateSearchCountRequests"],
  getMessageSearchCountRequestStatus: [
    "isolation",
    "result",
    "updateSearchCountRequests",
  ],
  listRunnableMessageSearchCounts: ["result"],
  releaseMessageSearchCountRequest: ["updateSearchCountRequests"],
  requestMessageSearchCount: [
    "advisoryLock",
    "cancelOtherRequests",
    "cancelRequests",
    "existing",
    "inserted",
  ],
} as const);

const conversationReads = readSqlBundle(conversationReadsSql, {
  commitMessageConversationRead: [
    "conversation",
    "membership",
    "rangesFragment",
    "rangesFragment2",
    "rangesFragment3",
    "readPredicateFragment",
    "readPredicateFragment2",
    "readPredicateFragment3",
    "unread",
    "updatedMembership",
  ],
} as const);

const messageHides = readSqlBundle(messageHidesSql, {
  commitMessageHides: [
    "bumped",
    "changesFragment",
    "conversation",
    "insertConversationChanges",
    "inserted",
    "membership",
    "placeholdersFragment",
    "source",
    "updateConversationMembers",
  ],
} as const);

const identityBackupRefresh = readSqlBundle(identityBackupRefreshSql, {
  commitMessageIdentityBackupRefresh: [
    "accountState",
    "affected",
    "bumpedConversation",
    "coverageState",
    "identity",
    "insertConversationChanges",
    "insertSearchAccountState",
    "lockedAccountState",
    "resetCoverage",
    "selectSearchCoverage",
    "updatedState",
  ],
} as const);

const backfills = readSqlBundle(backfillsSql, {
  commitMessageSearchBackfillBatch: [
    "claimed",
    "deleteSearchGaps",
    "deleteSearchReferences",
    "documentTuplesFragment",
    "epochTuplesFragment",
    "gapTuplesFragment",
    "insertSearchDocuments",
    "insertSearchGaps",
    "insertSearchReferences",
    "insertSearchTerms",
    "referenceTuplesFragment",
    "sourceRows",
    "termRows",
    "tuplesFragment",
    "updateMessages",
    "updateSearchCoverage",
  ],
  listRunnableMessageSearchBackfills: ["result"],
  readNextMessageSearchBackfillBatch: ["coverage", "messages"],
  startMessageSearchBackfill: ["insertSearchCoverage", "result"],
} as const);

const messageMutations = readSqlBundle(messageMutationsSql, {
  commitMessageSearchMutation: [
    "audience",
    "conversationLock",
    "deleteMessage",
    "deleteSearchGaps",
    "editMessage",
    "insertConversationChanges",
    "insertSearchOutbox",
    "readPredicateFragment",
    "readPredicateFragment2",
    "sequence",
    "source",
    "updateConversationMembers",
  ],
} as const);

const searchReaders = readSqlBundle(searchReadersSql, {
  countMessageSearchCandidates: ["isolation", "timeout"],
  explainSearchMessageCandidatesForDiagnostics: ["result"],
  fragmentFrequency: ["query"],
  hydrateSearchMessageCandidates: ["result"],
  listMessageSearchReferences: [
    "cursorConditionFragment",
    "cursorConditionFragment2",
    "orderingFragment",
    "orderingFragment2",
    "result",
  ],
  searchMessageCandidates: ["isolation", "query"],
  searchMessageCandidatesSelective: ["query"],
  searchMessageCount: ["query"],
  searchOrderedCandidateHits: ["query"],
  searchOrderedDocumentPage: ["query"],
} as const);

const conversationChanges = readSqlBundle(conversationChangesSql, {
  listMessageConversationChanges: ["result"],
} as const);

const unreadCounters = readSqlBundle(unreadCountersSql, {
  reconcileMessageUnreadCounter: [
    "conversation",
    "count",
    "joined",
    "member",
    "updateConversationMembers",
    "updated",
  ],
} as const);

const searchCoverage = readSqlBundle(searchCoverageSql, {
  lockMessageSearchCoverageRow: ["insertSearchCoverage", "locked"],
  refreshUnreadableSearchCoverage: ["coverage", "updated"],
} as const);

const searchOutbox = readSqlBundle(searchOutboxSql, {
  markSearchOutboxUnreadable: [
    "completed",
    "coverage",
    "deleteSearchGaps",
    "insertSearchGaps",
    "pending",
    "source",
    "updatedCoverage",
  ],
  recordMessageSearchOutboxFailure: ["result"],
} as const);

const searchDocuments = readSqlBundle(searchDocumentsSql, {
  persistSearchDocument: [
    "coverage",
    "deleteSearchDocuments",
    "deleteSearchGaps",
    "deleteSearchGaps2",
    "deleteSearchReferences",
    "deleteSearchReferences2",
    "deleteSearchTerms",
    "insertSearchDocuments",
    "insertSearchReferences",
    "insertSearchTerms",
    "outbox",
    "source",
    "termRows",
    "tuplesFragment",
    "tuplesFragment2",
    "updateMessages",
    "updatedCoverage",
  ],
} as const);

const epochReadability = readSqlBundle(epochReadabilitySql, {
  currentEpochProof: ["query"],
  epochFingerprint: ["query"],
  messageViewerEpochCoverage: ["query"],
  persistMessageSearchEpochProofs: ["withJsonbToRecordset"],
  readableMessageKeyEpochsSql: ["selectConversationKeys"],
  resolvedWrapper: ["query"],
  unverifiedConversationEpoch: ["query"],
} as const);

export const messageSearchSql = {
  ...countRequests,
  ...conversationReads,
  ...messageHides,
  ...identityBackupRefresh,
  ...backfills,
  ...messageMutations,
  ...searchReaders,
  ...conversationChanges,
  ...unreadCounters,
  ...searchCoverage,
  ...searchOutbox,
  ...searchDocuments,
  ...epochReadability,
} as const;
