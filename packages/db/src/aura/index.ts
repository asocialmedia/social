// Aura reputation economy. Public surface:
//  - config: every tunable constant (weights, curves, caps, thresholds)
//  - engine: pure delta math (credibility, taper, caps, milestones, momentum)
//  - ledger: the only balance writers + auditors (apply/reverse/penalize)
//  - signals: derived per-user projections for feed/trending consumers
// oxlint-disable oxc/no-barrel-file -- intentional public surface re-exported through the package barrel
export * from "./config";
export * from "./engine";
export * from "./ledger";
export * from "./signals";
export * from "./trending-card";
