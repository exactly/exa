#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

// cspell:ignore NSJSON

static NSString *const AppGroupIdentifier = @"group.app.exactly";
static NSString *const CardSnapshotKey = @"cardProvisioningSnapshot";
static NSString *const KeychainAccount = @"default";
static NSString *const KeychainService = @"walletExtensionToken";

static NSMutableDictionary *KeychainQuery(void)
{
  return [@{
    (__bridge NSString *)kSecAttrAccount : KeychainAccount,
    (__bridge NSString *)kSecAttrService : KeychainService,
    (__bridge NSString *)kSecClass : (__bridge id)kSecClassGenericPassword,
  } mutableCopy];
}

static NSError *WalletStorageError(NSString *code, NSString *message)
{
  return [NSError errorWithDomain:@"WalletExtensionStorage" code:0 userInfo:@{
    NSLocalizedDescriptionKey : message,
    @"code" : code,
  }];
}

static NSError *KeychainError(OSStatus status)
{
  return WalletStorageError(@"keychain", [NSString stringWithFormat:@"Keychain operation failed: %d", (int)status]);
}

@interface WalletExtensionStorage : NSObject <RCTBridgeModule>
@end

@implementation WalletExtensionStorage

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(saveWalletExtensionToken,
                 saveWalletExtensionToken:(NSString *)token
                 expire:(NSNumber *)expire
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"token" : token, @"expire" : expire} options:0 error:&error];
  if (!data) {
    reject(@"invalidData", @"Invalid wallet extension token.", error);
    return;
  }

  NSMutableDictionary *query = KeychainQuery();
  SecItemDelete((__bridge CFDictionaryRef)query);
  query[(__bridge NSString *)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
  query[(__bridge NSString *)kSecValueData] = data;
  OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
  if (status != errSecSuccess) {
    NSError *keychainError = KeychainError(status);
    reject(@"keychain", keychainError.localizedDescription, keychainError);
    return;
  }
  resolve(nil);
}

RCT_REMAP_METHOD(getWalletExtensionToken,
                 getWalletExtensionTokenWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSMutableDictionary *query = KeychainQuery();
  query[(__bridge NSString *)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  query[(__bridge NSString *)kSecReturnData] = @YES;
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
  if (status == errSecItemNotFound) {
    resolve([NSNull null]);
    return;
  }
  if (status != errSecSuccess) {
    NSError *error = KeychainError(status);
    reject(@"keychain", error.localizedDescription, error);
    return;
  }

  NSError *error = nil;
  id value = [NSJSONSerialization JSONObjectWithData:CFBridgingRelease(result) options:0 error:&error];
  if (!value || ![value isKindOfClass:NSDictionary.class]) {
    reject(@"invalidData", @"Invalid wallet extension token data.", error);
    return;
  }
  resolve(value);
}

RCT_REMAP_METHOD(clearWalletExtensionStorage,
                 clearWalletExtensionStorageWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)KeychainQuery());
  if (status != errSecSuccess && status != errSecItemNotFound) {
    NSError *error = KeychainError(status);
    reject(@"keychain", error.localizedDescription, error);
    return;
  }

  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:AppGroupIdentifier];
  if (!defaults) {
    NSError *error = WalletStorageError(@"invalidAppGroup", @"Unable to open wallet extension app group.");
    reject(@"invalidAppGroup", error.localizedDescription, error);
    return;
  }
  [defaults removeObjectForKey:CardSnapshotKey];
  resolve(nil);
}

RCT_REMAP_METHOD(saveCardProvisioningSnapshot,
                 saveCardProvisioningSnapshot:(NSDictionary *)snapshot
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:AppGroupIdentifier];
  if (!defaults) {
    NSError *error = WalletStorageError(@"invalidAppGroup", @"Unable to open wallet extension app group.");
    reject(@"invalidAppGroup", error.localizedDescription, error);
    return;
  }
  [defaults setObject:snapshot forKey:CardSnapshotKey];
  resolve(nil);
}

RCT_REMAP_METHOD(getCardProvisioningSnapshot,
                 getCardProvisioningSnapshotWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:AppGroupIdentifier];
  if (!defaults) {
    NSError *error = WalletStorageError(@"invalidAppGroup", @"Unable to open wallet extension app group.");
    reject(@"invalidAppGroup", error.localizedDescription, error);
    return;
  }
  resolve([defaults dictionaryForKey:CardSnapshotKey] ?: [NSNull null]);
}

@end
