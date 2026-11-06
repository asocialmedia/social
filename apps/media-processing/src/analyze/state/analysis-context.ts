import { AsyncLocalStorage } from "node:async_hooks";

const lane = new AsyncLocalStorage<boolean>();
export const withAnalysisLane = <T>(
  background: boolean,
  run: () => Promise<T>
): Promise<T> => lane.run(background, run);
export const isBackgroundAnalysis = (): boolean => lane.getStore() === true;
