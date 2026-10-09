package expo.modules.messagekdf

import org.junit.Assert.assertEquals
import org.junit.Test

class MessageKeyDerivationTest {
  private val salt = ByteArray(16) { it.toByte() }

  @Test
  fun matchesStoredRowWebCryptoBackup() {
    val key = MessageKeyDerivation.derive("a".repeat(64), salt, 100_000)
    assertEquals("754d01d6c150061c2988099c8fa4283cc6a7c329d02098f1b33a7b0683b07987", key.hex())
  }

  @Test
  fun matchesUtf8IncludingNullAndCombiningCharacters() {
    val key = MessageKeyDerivation.derive("密碼🔑\u0000é", salt, 1000)
    assertEquals("1b2eefaa30cce95490d0ae554c8208a570c0ea8c017e9993aa3fb4a7c5f5a07a", key.hex())
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsZeroIterations() {
    MessageKeyDerivation.derive("hash", salt, 0)
  }

  private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
