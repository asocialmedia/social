package expo.modules.messagekdf

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MessageKdfModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MessageKdf")

    // Expo's async module queue keeps key recovery off both JS and UI threads.
    AsyncFunction("deriveAsync") { secret: String, salt: ByteArray, iterations: Int ->
      MessageKeyDerivation.derive(secret, salt, iterations)
    }
  }
}
