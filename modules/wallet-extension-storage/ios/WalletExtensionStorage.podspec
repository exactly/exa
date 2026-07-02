require "json"

# cspell:ignore xcconfig

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name = "WalletExtensionStorage"
  s.version = package["version"]
  s.summary = package["description"]
  s.description = package["description"]
  s.license = package["license"]
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
