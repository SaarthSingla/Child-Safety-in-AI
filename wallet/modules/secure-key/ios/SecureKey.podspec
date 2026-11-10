Pod::Spec.new do |s|
  s.name           = 'SecureKey'
  s.version        = '1.0.0'
  s.summary        = 'Secure Enclave P-256 holder key for ChildSafeWallet'
  s.description    = 'Creates a non-exportable Secure Enclave P-256 key and signs ES256 with it.'
  s.author         = ''
  s.homepage       = 'https://example.invalid/secure-key'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CryptoKit', 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
