import * as Network from "expo-network";
import { AppState } from "react-native";

import { ForegroundNetworkPoller } from "./foreground-network-poller";
import type { PollerOptions } from "./foreground-network-poller";

export function createExpoPoller(options: {
  intervalMs: number;
  onPoll: () => Promise<void> | void;
}): ForegroundNetworkPoller {
  return new ForegroundNetworkPoller({
    ...options,
    appState: {
      getCurrentState: () => AppState.currentState,
      subscribe: (listener) => AppState.addEventListener("change", listener),
    },
    network: {
      getState: () => Network.getNetworkStateAsync(),
      subscribe: (listener) => Network.addNetworkStateListener(listener),
    } satisfies PollerOptions["network"],
  } satisfies PollerOptions);
}
