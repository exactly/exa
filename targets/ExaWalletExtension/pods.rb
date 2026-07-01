# cspell:ignore meawallet mpp

pod 'WalletExtensionStorage', :path => '../modules/wallet-extension-storage/ios'
pod 'meawallet-react-native-mpp', :path => `node --print "const path = require('node:path'); path.relative(process.cwd(), path.dirname(require.resolve('@meawallet/react-native-mpp/package.json')))"`.strip
