# @exactly/plugin

## 1.0.0

### Major Changes

- [`e04ab08`](https://github.com/exactly/exa/commit/e04ab082f0f253714f41789be74bfafd4eaf05c6) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🔖 exa plugin v1 featuring:

  - modular plugin for interacting with the exactly protocol using account abstraction
  - ERC-4337 v0.6.0 and ERC-6900 v0.7.0 support
  - proposal and delay system for operations that decrease account's collateral
  - asset swap utilities
  - plugin replace enforcement
  - keeper role to facilitate operations on behalf of accounts
    - deposit collateral to the protocol
    - charge accounts with a signature from the issuer
    - propose debt repayments

### Patch Changes

- [`bc61cdc`](https://github.com/exactly/exa/commit/bc61cdc9eb7e53b097bf40e91e762e623a614b56) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ✨ allow refunder withdraw

- [`29706a3`](https://github.com/exactly/exa/commit/29706a3947d117a6548abf22cdd7f5e9115cc0a1) Thanks [@itofarina](https://github.com/itofarina)! - ✨ detach collect from proposals

- [`a116719`](https://github.com/exactly/exa/commit/a116719ab14a96e3bbec3bc123585c1f40c36d1e) Thanks [@itofarina](https://github.com/itofarina)! - 🔥 drop unneeded check

- [`75aa696`](https://github.com/exactly/exa/commit/75aa696063e8f91ef462a278a5ff82eaa2596564) Thanks [@itofarina](https://github.com/itofarina)! - 🚸 improve accountability on repays

- [`3519a0c`](https://github.com/exactly/exa/commit/3519a0cebc39a4565834283548472bd981b0bb9e) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ✨ add markets function to previewer

- [`614a3ff`](https://github.com/exactly/exa/commit/614a3ff07d916fdc8aa67954e9aacaab15572b19) Thanks [@itofarina](https://github.com/itofarina)! - 🔥 drop unneeded check

- [`d3c5264`](https://github.com/exactly/exa/commit/d3c526482b3cc77e5c51c3fdaab47d13adb700c3) Thanks [@itofarina](https://github.com/itofarina)! - ✨ expose uninstall proposals through account

- [`45cf89d`](https://github.com/exactly/exa/commit/45cf89dc17053dfeeeea0b1b695344caf0b988ae) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ⚡️ cache storage reads

- [`76a2ce4`](https://github.com/exactly/exa/commit/76a2ce4bfa8d375f72b512fd44a440bc4084447f) Thanks [@itofarina](https://github.com/itofarina)! - 🔒️ clear pending proposals on uninstall

- [`cbf6153`](https://github.com/exactly/exa/commit/cbf6153d34f11ab61f5989a0ccbfa8a21862dcd5) Thanks [@itofarina](https://github.com/itofarina)! - 🚸 execute proposal deterministically

- [`e8c735f`](https://github.com/exactly/exa/commit/e8c735fc20ac5a519d301075da54c7bb5158db0d) Thanks [@itofarina](https://github.com/itofarina)! - 👔 restrict keeper proposals

- [`13d100e`](https://github.com/exactly/exa/commit/13d100e566c84591c621da16790ddd8ec6c42049) Thanks [@itofarina](https://github.com/itofarina)! - ✨ allow setting flash loaner

- [`435f5e3`](https://github.com/exactly/exa/commit/435f5e3aeac57aa2e5afe7845e6609bd64af7200) Thanks [@itofarina](https://github.com/itofarina)! - 🔒 store call hash on uninstall

- [`ad3db36`](https://github.com/exactly/exa/commit/ad3db36aca944bf23ddc97721ae2af536ee2b5ff) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ✨ preview pending proposals unlock time

- [`0b289f9`](https://github.com/exactly/exa/commit/0b289f9ea7a9abff9524bcc80df93ea24e8ebed6) Thanks [@itofarina](https://github.com/itofarina)! - 🔒 invalidate already used issuer hashes

- [`d51f75a`](https://github.com/exactly/exa/commit/d51f75aa5236b7652e02c7c89b1725977a3f6d14) Thanks [@itofarina](https://github.com/itofarina)! - ✨ allow setting the swapper

- [`aceb1b5`](https://github.com/exactly/exa/commit/aceb1b5be29a84cb2a37742e2204647d249443ab) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🚀 deploy all contracts to optimism

- [`47939dc`](https://github.com/exactly/exa/commit/47939dca018f55837963edac08db0dfff1a1a770) Thanks [@itofarina](https://github.com/itofarina)! - 🔥 drop unneeded cast

- [`cf9565a`](https://github.com/exactly/exa/commit/cf9565a67d7771b8aa1015dfce07ec69a4ccdef9) Thanks [@itofarina](https://github.com/itofarina)! - ✨ check call hash on withdrawal to proposer

- [`8605a61`](https://github.com/exactly/exa/commit/8605a611fcffd1053ca04991a6cfc4ce03f43b27) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🎨 refactor allowlist management interface

- [`4f16624`](https://github.com/exactly/exa/commit/4f166246635e042e6024f4dda8ecd0cffe7abdd8) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add assets function to previewer

- [`4c02d6e`](https://github.com/exactly/exa/commit/4c02d6ee59c94065e8b40686b862a68220fe78b8) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ♻️ split call hash usage

- [`1ac3846`](https://github.com/exactly/exa/commit/1ac3846c6149ab13d5f85e21400b08d7b3bce7c8) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🔥 drop unused return value

- [`6574a07`](https://github.com/exactly/exa/commit/6574a075a336cd42778ded8aa61b43244ef69d45) Thanks [@itofarina](https://github.com/itofarina)! - 🔥 drop unneeded check

- [`b9b1515`](https://github.com/exactly/exa/commit/b9b1515fd6eb43657b310e17901ebf27d0b67b56) Thanks [@itofarina](https://github.com/itofarina)! - 🔒️ add reentrancy lock on public swap

- [`6647f88`](https://github.com/exactly/exa/commit/6647f887400ec130e9f8e34fc858066f27c43d0d) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🚚 rename exa previewer

- [`2e8e984`](https://github.com/exactly/exa/commit/2e8e9841ea7b2d71520854ff393c2c88e837cc85) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🚚 split plugin and factory deployment

- [`e463014`](https://github.com/exactly/exa/commit/e463014f8eacac899c88d6d21ca20c986b043221) Thanks [@itofarina](https://github.com/itofarina)! - 🔊 emit collected and refunded on issuer checker

- [`e3ee4c5`](https://github.com/exactly/exa/commit/e3ee4c5df0f2938d705ab36834b872cdbb4e40ec) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ⚡️ optimize plugin manifest

- [`46ff04d`](https://github.com/exactly/exa/commit/46ff04d8f038c22f0a47a8cccf71b7fa7aea9dc0) Thanks [@itofarina](https://github.com/itofarina)! - 🐛 clear call hash after withdraw on repay

- [`26b30cc`](https://github.com/exactly/exa/commit/26b30ccd86f0ffda4f025c79d80412b3a3e66714) Thanks [@itofarina](https://github.com/itofarina)! - 🔒️ fix uninstall restrictions

- [`84e3e33`](https://github.com/exactly/exa/commit/84e3e333a8bc6246194ff25b1a53f3b427b2c01b) Thanks [@itofarina](https://github.com/itofarina)! - 🔒️ restrict uninstalls

- [`ca25e38`](https://github.com/exactly/exa/commit/ca25e38ee45feaf24f441657aa4da51cea785864) Thanks [@itofarina](https://github.com/itofarina)! - 🔊 sort event parameters on issuer checker

- [`04b96bf`](https://github.com/exactly/exa/commit/04b96bf0b07725f016d20cc8e01408113759faa8) Thanks [@itofarina](https://github.com/itofarina)! - 🔥 remove unneeded approvals

- [`4377c4a`](https://github.com/exactly/exa/commit/4377c4aa3126e8d2029a66504e7cb8164b365468) Thanks [@itofarina](https://github.com/itofarina)! - ✨ increment nonce when reading proposals

- [`25c4f1b`](https://github.com/exactly/exa/commit/25c4f1ba18c9bc725efb86ae9dc086e676d9dd07) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🔒 enforce market check even when allowlisted

- [`368df25`](https://github.com/exactly/exa/commit/368df252a3db7b2e370f1ed0af8db0939b45138e) Thanks [@itofarina](https://github.com/itofarina)! - ♻️ move swapper check to allowlist

- [`ba97c56`](https://github.com/exactly/exa/commit/ba97c5686ed1d2ddd1b80e525cffcfd417ac013e) Thanks [@itofarina](https://github.com/itofarina)! - 🦺 check proposal type on roll debt

- [`9f69cac`](https://github.com/exactly/exa/commit/9f69cace539a6230a6844ad3b95173ff4d1ba6a6) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add pending proposals to previewer

- [`0322e47`](https://github.com/exactly/exa/commit/0322e47cac3d692ee90cf5b27679a812b54748d4) Thanks [@itofarina](https://github.com/itofarina)! - 🦺 validate proposal type on pre execution

- [`bd44d8b`](https://github.com/exactly/exa/commit/bd44d8b753e602d9471f1e0983f22e49dfb80f3b) Thanks [@itofarina](https://github.com/itofarina)! - 🔒 add execution hook for uninstall

- [`fde5d2f`](https://github.com/exactly/exa/commit/fde5d2f1df71199f12b9a59d5d2b16f5b1873863) Thanks [@itofarina](https://github.com/itofarina)! - ✨ simulate collects on previewer using proposals

- [`4c6c89e`](https://github.com/exactly/exa/commit/4c6c89e84296a34293ea496015816f017087b728) Thanks [@itofarina](https://github.com/itofarina)! - 🔒 prevent uninstall with pending proposals

- [`08edc63`](https://github.com/exactly/exa/commit/08edc637efc6cbd801720c0d33e56327edf6b07a) Thanks [@itofarina](https://github.com/itofarina)! - 🔒️ prevent new proposals when uninstalling

## 0.0.5

### Patch Changes

- [`b69e45f`](https://github.com/exactly/mobile/commit/b69e45f77e46aa32863c0a603f701bd8370a9c2f) Thanks [@itofarina](https://github.com/itofarina)! - 🦺 prevent uninstall with no proposal

- [`13815ac`](https://github.com/exactly/mobile/commit/13815ac45a0337f8da7727a998f8e2dd68d39f81) Thanks [@itofarina](https://github.com/itofarina)! - ♻️ use returned assets from redeem

- [`8fc53bc`](https://github.com/exactly/mobile/commit/8fc53bc8d85efde84a03cfe02a43e47a3cc9470b) Thanks [@itofarina](https://github.com/itofarina)! - 🎨 rename repay at maturity proposal

- [`4420d1a`](https://github.com/exactly/mobile/commit/4420d1a68922b54cebcbee1c7bd1a13ddecff0f1) Thanks [@itofarina](https://github.com/itofarina)! - 🐛 consume proposals on repays

- [`f1c2c1e`](https://github.com/exactly/mobile/commit/f1c2c1e2ba3fdc716d8f535b755881db81b375de) Thanks [@itofarina](https://github.com/itofarina)! - 🔊 contracts: add executed to proposal nonce set

## 0.0.4

### Patch Changes

- [`03f2f40`](https://github.com/exactly/mobile/commit/03f2f406c1d332f083872f649e12f2e241c61895) Thanks [@itofarina](https://github.com/itofarina)! - 🛂 add reentrancy lock on internal swap

- [`a2a54ac`](https://github.com/exactly/mobile/commit/a2a54ac794f11229e0159e7bd1ea5bda8a6fcc73) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add revoke proposal

- [`d8fde6d`](https://github.com/exactly/mobile/commit/d8fde6de9861eac365d37b800d2e196a168ad9ab) Thanks [@itofarina](https://github.com/itofarina)! - ✨ extract proposal manager

- [`2be449a`](https://github.com/exactly/mobile/commit/2be449a94ad63c79aba3f10907aa206fdf0723e5) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add borrow at maturity proposal

- [`bff01b6`](https://github.com/exactly/mobile/commit/bff01b6af8d6a1f41d57b30a40d77e3c4edaca20) Thanks [@itofarina](https://github.com/itofarina)! - 🛂 prevent shares swap

- [`7e04016`](https://github.com/exactly/mobile/commit/7e0401624f53290fc668074588d033ef99d164e9) Thanks [@itofarina](https://github.com/itofarina)! - 🔊 emit proposed for all proposals

- [`45b6830`](https://github.com/exactly/mobile/commit/45b68303a5b91b6b9f13348c815987fcc4eab847) Thanks [@itofarina](https://github.com/itofarina)! - ✨ roll debt with proposals

- [`be037cf`](https://github.com/exactly/mobile/commit/be037cf918ee77df5bc7c0dbdfefab52463b1c03) Thanks [@itofarina](https://github.com/itofarina)! - 🩹 reset sender approval after execution

- [`172fa93`](https://github.com/exactly/mobile/commit/172fa932d5043964e6c7ec6f4c4eef2e9cc30051) Thanks [@itofarina](https://github.com/itofarina)! - 👔 enter market when depositing unspent

- [`ebec51a`](https://github.com/exactly/mobile/commit/ebec51a9565379c4f6308d183e418e2e0311ad41) Thanks [@itofarina](https://github.com/itofarina)! - 👔 make delay configurable by admin

- [`6d834a5`](https://github.com/exactly/mobile/commit/6d834a5d6e04a0efb0f2fa86eff88d7c2d22861a) Thanks [@itofarina](https://github.com/itofarina)! - 🔊 restructure proposed event

- [`f2dc87c`](https://github.com/exactly/mobile/commit/f2dc87c8c4360f7c6a239963fb380e60eafff565) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add proposal mechanism to uninstall

- [`7348bce`](https://github.com/exactly/mobile/commit/7348bced2a76469493954c8ded5f2a61a2156d5c) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🔒️ deny direct execution through user op

- [`d1d4d4b`](https://github.com/exactly/mobile/commit/d1d4d4b232ac006b1622aa0f5ca6d79d4f15d86e) Thanks [@itofarina](https://github.com/itofarina)! - 🛂 decouple uninstall from proposal manager

- [`322528d`](https://github.com/exactly/mobile/commit/322528d333818302cb669a097fc3696c1e1ae878) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add redeem proposal

- [`5caeded`](https://github.com/exactly/mobile/commit/5caeded5defc937e4580038dd6cc619a477abcde) Thanks [@itofarina](https://github.com/itofarina)! - 🦺 validate all execute batch calls

- [`3829f12`](https://github.com/exactly/mobile/commit/3829f1243657dde7e2c35713fd44f1b770baea4c) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add cross repay proposal

- [`3fd34e4`](https://github.com/exactly/mobile/commit/3fd34e47cfaefb2b93271b67990c05a77b76e224) Thanks [@itofarina](https://github.com/itofarina)! - 👔 allow proposals by keeper or self

- [`e50add9`](https://github.com/exactly/mobile/commit/e50add9eeae6f44974ee7822ca11546b8320ecff) Thanks [@itofarina](https://github.com/itofarina)! - ♻️ receive constructor parameters on a struct

- [`deb783c`](https://github.com/exactly/mobile/commit/deb783c3318d2598c6528b9632f4cecf74b148d9) Thanks [@itofarina](https://github.com/itofarina)! - 👔 unify proposals entry point

- [`876fc89`](https://github.com/exactly/mobile/commit/876fc89ecaef2f8ca229665a36b44ba203bbb2db) Thanks [@itofarina](https://github.com/itofarina)! - ✨ support multiple proposals

- [`8319609`](https://github.com/exactly/mobile/commit/8319609ba3060a01d7537c9ea0dcbd632f7f1739) Thanks [@itofarina](https://github.com/itofarina)! - 👔 move withdraw receiver to proposal data

- [`d940729`](https://github.com/exactly/mobile/commit/d940729abcd3f9bef82d54cb222dea92cfe90edd) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add repay proposal

- [`a04eb0f`](https://github.com/exactly/mobile/commit/a04eb0fd7eb422bdd148edb62a96fd55477e5f52) Thanks [@itofarina](https://github.com/itofarina)! - 🛂 restrict callable targets and selectors

- [`95f4ca1`](https://github.com/exactly/mobile/commit/95f4ca1b1fc7ba94c14733115561f458a1b7da5a) Thanks [@itofarina](https://github.com/itofarina)! - 👔 split operations into different types

- [`05d44af`](https://github.com/exactly/mobile/commit/05d44af389a081b3fb9d74dfbd6ea28372a61e7b) Thanks [@itofarina](https://github.com/itofarina)! - 🦺 check time locked on eth withdrawal

## 0.0.3

### Patch Changes

- [`4a554a2`](https://github.com/exactly/mobile/commit/4a554a2d5dfba63d63558c93ca668797869c469d) Thanks [@itofarina](https://github.com/itofarina)! - ✨ expose lifi swap

- [`69d5644`](https://github.com/exactly/mobile/commit/69d5644f6eca8a295ba53ae4586f993d782788c2) Thanks [@itofarina](https://github.com/itofarina)! - 🛂 allow self to roll debt

- [`b11f3f1`](https://github.com/exactly/mobile/commit/b11f3f1e4f8b1c183c3f73d450ae4460e849aa19) Thanks [@itofarina](https://github.com/itofarina)! - ✨ integrate lifi on cross repay

- [`cdf005f`](https://github.com/exactly/mobile/commit/cdf005f80edcad3038d63b2078802afb8dbe89dd) Thanks [@itofarina](https://github.com/itofarina)! - 🦺 add liquidity checks on repay

- [`74addb4`](https://github.com/exactly/mobile/commit/74addb4bf4512c3cdd5e124aca1fa2072520a0fb) Thanks [@itofarina](https://github.com/itofarina)! - 👔 prevent borrows where receiver is not collector

- [`e2b4c1f`](https://github.com/exactly/mobile/commit/e2b4c1f8f482d5320001e762512340204db111f1) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add collect collateral

- [`4e2d621`](https://github.com/exactly/mobile/commit/4e2d6216d7044a6b0269756ea0260543786f9b4f) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ✨ implement swap proposals

- [`9b4ab9a`](https://github.com/exactly/mobile/commit/9b4ab9a960ef7ef128b399b84eb652efa8acc084) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add roll debt

- [`2d65dc4`](https://github.com/exactly/mobile/commit/2d65dc4f565d66ca31f1b05e5b9d7b00e5a393fe) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - 🔥 remove minimum health factor

- [`a1727c2`](https://github.com/exactly/mobile/commit/a1727c2114962121e4a895dd6b82ba9de2d51d25) Thanks [@itofarina](https://github.com/itofarina)! - ✨ simplify repay by receiving arguments

- [`3708969`](https://github.com/exactly/mobile/commit/3708969f513816d456eb1d3cb16b34e0c05c1656) Thanks [@cruzdanilo](https://github.com/cruzdanilo)! - ✨ accept factory stake donation

- [`c7381dc`](https://github.com/exactly/mobile/commit/c7381dcb2b71e7e771f26c089a1b925da9afa0a7) Thanks [@itofarina](https://github.com/itofarina)! - 🛂 set admin address on constructors

- [`03104c6`](https://github.com/exactly/mobile/commit/03104c632c29c5a4d1580283bc27891937dc2b71) Thanks [@itofarina](https://github.com/itofarina)! - 👔 drop min credit factor, check min health factor on collect

- [`b12dfcd`](https://github.com/exactly/mobile/commit/b12dfcde5ad170257d51d50a4c3d6605209dd5e4) Thanks [@itofarina](https://github.com/itofarina)! - 👔 handle swaps with boundaries

- [`ede5f26`](https://github.com/exactly/mobile/commit/ede5f26a7acb71b8340a491e8fea17ddb3b3d181) Thanks [@itofarina](https://github.com/itofarina)! - ✨ prevent exit market

- [`2a62ed7`](https://github.com/exactly/mobile/commit/2a62ed77daf5cf551de4684828f155ba46120b9a) Thanks [@itofarina](https://github.com/itofarina)! - 👔 decrease proposal delay to 1 minute

- [`e2c46e0`](https://github.com/exactly/mobile/commit/e2c46e098157d19593d49d47b1086bb2434762d9) Thanks [@itofarina](https://github.com/itofarina)! - ✨ allow keeper to repay on behalf of account

- [`cf93250`](https://github.com/exactly/mobile/commit/cf93250e6c1e872591a6ddbc515c73d252e16545) Thanks [@itofarina](https://github.com/itofarina)! - ✨ add min credit factor for collect credit

- [`8004ba7`](https://github.com/exactly/mobile/commit/8004ba7edb804d37a224ae6912ebb2c7332fe875) Thanks [@itofarina](https://github.com/itofarina)! - ✨ allow custom slippage on collect credit

- [`a1d2f3f`](https://github.com/exactly/mobile/commit/a1d2f3f0e71533d2d88e14e296a21f781db3c28c) Thanks [@itofarina](https://github.com/itofarina)! - 🔊 emit event when setting issuer
