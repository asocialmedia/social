import {
  configureNativeEntropy,
  setNativeMasterKeyDeriver,
} from "@/features/messages/lib/crypto";

import MessageKdfModule from "../../../../modules/message-kdf/src/message-kdf-module";

export async function configureNativeMessageCrypto(): Promise<void> {
  await configureNativeEntropy();
  const nativeModule = MessageKdfModule;
  setNativeMasterKeyDeriver(
    nativeModule
      ? (secret, salt, iterations) =>
          nativeModule.deriveAsync(secret, salt, iterations)
      : null
  );
}
