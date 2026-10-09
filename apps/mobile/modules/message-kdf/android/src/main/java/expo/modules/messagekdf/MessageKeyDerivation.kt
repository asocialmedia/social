package expo.modules.messagekdf

import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

internal object MessageKeyDerivation {
  fun derive(secret: String, salt: ByteArray, iterations: Int): ByteArray {
    require(iterations > 0) { "Iterations must be positive" }
    require(salt.isNotEmpty()) { "Salt must not be empty" }
    val password = secret.toCharArray()
    val specification = PBEKeySpec(password, salt, iterations, 256)
    try {
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        .generateSecret(specification).encoded
    } finally {
      specification.clearPassword()
      password.fill('\u0000')
    }
  }
}
