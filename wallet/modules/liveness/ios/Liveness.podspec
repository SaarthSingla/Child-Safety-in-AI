Pod::Spec.new do |s|
  s.name           = 'Liveness'
  s.version        = '1.0.0'
  s.summary        = 'ARKit face-tracking liveness view for ChildSafeWallet'
  s.description    = 'Streams face pose, expression and depth-relief signals and captures the live frame.'
  s.author         = ''
  s.homepage       = 'https://example.invalid/liveness'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ARKit', 'SceneKit', 'CoreImage'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,swift}'
end
