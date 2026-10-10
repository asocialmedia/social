import { Platform } from "react-native";

import {
  configureNativeEntropy,
  setNativeMasterKeyDeriver,
} from "@/features/messages/lib/crypto";
import { supportsNativeMessageKdf } from "@/features/messages/lib/native-kdf-availability";

import MessageKdfModule from "../../../../modules/message-kdf/src/message-kdf-module";

export async function configureNativeMessageCrypto(): Promise<void> {
  await configureNativeEntropy();
  const nativeModule = MessageKdfModule;
  setNativeMasterKeyDeriver(
    nativeModule && supportsNativeMessageKdf(Platform.OS, Platform.Version)
      ? (secret, salt, iterations) =>
          nativeModule.deriveAsync(secret, salt, iterations)
      : null
  );
}
