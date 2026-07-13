# cspell:ignore xcconfig

Pod::Spec.new do |s|
  s.name = "WalletExtensionStorage"
  s.version = "1.0.0"
  s.summary = "Shared storage for Exa Wallet extensions."
  s.description = "Shared storage for Exa Wallet extensions."
  s.license = "UNLICENSED"
  s.author = "Exactly"
  s.homepage = "https://exactly.app"
  s.platforms = { :ios => "15.1" }
  s.source = { :path => "." }
  s.static_framework = true
  s.dependency "React-Core"
  s.frameworks = "Foundation", "Security"
  s.pod_target_xcconfig = {
    "APPLICATION_EXTENSION_API_ONLY" => "YES",
    "DEFINES_MODULE" => "YES"
  }
  s.source_files = "**/*.{h,m,mm}"
end
