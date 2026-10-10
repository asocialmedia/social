import CommonCrypto
import ExpoModulesCore

public class MessageKdfModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MessageKdf")

    // AsyncFunction executes on Expo's background queue, never the JS/UI queue.
    AsyncFunction("deriveAsync") { (secret: String, salt: Data, iterations: Int) -> Data in
      guard iterations > 0, iterations <= Int(UInt32.max), !salt.isEmpty else {
        throw Exception(name: "InvalidKdfInput", description: "Invalid key derivation input")
      }
      var password = Array(secret.utf8)
      defer { password.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
      var key = Data(count: 32)
      let status = password.withUnsafeBytes { passwordBytes in
        salt.withUnsafeBytes { saltBytes in
          key.withUnsafeMutableBytes { keyBytes in
            CCKeyDerivationPBKDF(
              CCPBKDFAlgorithm(kCCPBKDF2),
              passwordBytes.baseAddress?.assumingMemoryBound(to: Int8.self), passwordBytes.count,
              saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), saltBytes.count,
              CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
              keyBytes.baseAddress?.assumingMemoryBound(to: UInt8.self), keyBytes.count
            )
          }
        }
      }
      guard status == kCCSuccess else {
        key.resetBytes(in: 0..<key.count)
        throw Exception(name: "KeyDerivationFailed", description: "Message key derivation failed")
      }
      return key
    }
  }
}
