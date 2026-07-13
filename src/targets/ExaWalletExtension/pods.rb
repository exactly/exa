# cspell:ignore meawallet mpp

pod 'WalletExtensionStorage', :path => '../src/modules/wallet-extension-storage/ios'
pod 'meawallet-react-native-mpp', :path => `cd "#{Pod::Config.instance.installation_root}" && node --print "const path = require('node:path'); path.relative(process.cwd(), path.dirname(require.resolve('@meawallet/react-native-mpp/package.json')))"`.strip
