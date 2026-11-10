import CryptoKit
import ExpoModulesCore
import Foundation
import Security

// The holder key lives in the Secure Enclave: the private key is generated
// inside it and can never be exported. What is kept in the Keychain is
// CryptoKit's dataRepresentation, an encrypted handle that only this
// device's Secure Enclave can use. Signing needs the device to be unlocked
// but no Face ID prompt.
public final class SecureKeyModule: Module {
  private static let service = "childsafe.holder.secure-enclave"
  private static let account = "holder-key-v2"

  public func definition() -> ModuleDefinition {
    Name("SecureKey")

    Property("isAvailable") {
      SecureEnclave.isAvailable
    }

    AsyncFunction("getOrCreatePublicJwk") { () -> [String: String] in
      let key = try Self.loadOrCreateKey()
      return Self.jwk(for: key.publicKey)
    }

    // Returns the ES256 JWS signature (raw r||s, base64url) over the UTF-8
    // bytes of signingInput. CryptoKit hashes with SHA-256 internally.
    AsyncFunction("sign") { (signingInput: String) -> String in
      let key = try Self.loadOrCreateKey()
      let signature = try key.signature(for: Data(signingInput.utf8))
      return Self.base64url(signature.rawRepresentation)
    }

    AsyncFunction("deleteKey") {
      Self.deleteStoredKey()
    }
  }

  private static func loadOrCreateKey() throws -> SecureEnclave.P256.Signing.PrivateKey {
    guard SecureEnclave.isAvailable else {
      throw SecureKeyError("This device has no Secure Enclave.")
    }

    if let data = readStoredKey() {
      return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: data)
    }

    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      nil,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      .privateKeyUsage,
      &error
    ) else {
      throw SecureKeyError("Unable to create key access control.")
    }

    let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
    try store(key.dataRepresentation)
    return key
  }

  private static func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func readStoredKey() -> Data? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else {
      return nil
    }
    return result as? Data
  }

  private static func store(_ data: Data) throws {
    var item = baseQuery()
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    SecItemDelete(baseQuery() as CFDictionary)
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw SecureKeyError("Unable to store the key handle (status \(status)).")
    }
  }

  private static func deleteStoredKey() {
    SecItemDelete(baseQuery() as CFDictionary)
  }

  private static func jwk(for publicKey: P256.Signing.PublicKey) -> [String: String] {
    // x963: 0x04 || X (32 bytes) || Y (32 bytes)
    let raw = publicKey.x963Representation
    return [
      "kty": "EC",
      "crv": "P-256",
      "x": base64url(raw.subdata(in: 1..<33)),
      "y": base64url(raw.subdata(in: 33..<65)),
    ]
  }

  private static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

struct SecureKeyError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}
