import PassKit
import UIKit

final class ExaWalletAuthorizationHandler: UIViewController, PKIssuerProvisioningExtensionAuthorizationProviding {
  var completionHandler: ((PKIssuerProvisioningExtensionAuthorizationResult) -> Void)?

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    completionHandler?(.canceled)
  }
}
