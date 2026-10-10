Pod::Spec.new do |s|
  s.name           = 'MessageKdf'
  s.version        = '1.0.0'
  s.summary        = 'Background message identity key derivation'
  s.description    = 'PBKDF2-SHA256 compatible with web message identity backups'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
