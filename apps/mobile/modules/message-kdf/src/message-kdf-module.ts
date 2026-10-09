import type { NativeModule } from "expo";
import { requireOptionalNativeModule } from "expo";

declare class MessageKdfModule extends NativeModule {
  deriveAsync(
    secret: string,
    salt: Uint8Array,
    iterations: number
  ): Promise<Uint8Array>;
}

// Expo Go has no app-local module; its caller uses the cooperative JS fallback.
export default requireOptionalNativeModule<MessageKdfModule>("MessageKdf");
