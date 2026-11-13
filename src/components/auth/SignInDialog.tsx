import React from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";

import { RefreshCw } from "../../generated/icons/RefreshCw";
import { Settings } from "../../generated/icons/Settings";
import { loginUnidentified, newMessage, present } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import ErrorDialog from "../shared/ErrorDialog";

import type { SignInIssue } from "../../utils/useAuth";

export default function SignInDialog({
  issue,
  open,
  onClose,
  onRetry,
}: {
  issue: SignInIssue;
  onClose: () => void;
  onRetry: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  switch (issue) {
    case "biometrics":
      return (
        <ErrorDialog
          open={open}
          title={t("Turn on Face ID")}
          description={t(
            "Your passkey is unlocked with Face ID or Touch ID. Open Settings, go to Face ID & Passcode and check that Face ID or Touch ID is set up. If it is locked, unlock your phone with your passcode. Then come back and try again.",
          )}
          action={{
            icon: <Settings />,
            label: t("Go to Settings"),
            onPress: () => {
              onClose();
              Linking.openSettings().catch(reportError);
            },
          }}
          onClose={onClose}
        />
      );
    case "passkey":
      return (
        <ErrorDialog
          open={open}
          title={t("No passkey found on this device")}
          description={t(
            "If you already have an account, your passkey is saved in the password manager you used to create it, like Google Password Manager or 1Password. Make sure that password manager is installed on this device, signed in to the same account and turned on in your passwords settings. Then try again.",
          )}
          action={{
            icon: <RefreshCw />,
            label: t("Try again"),
            onPress: () => {
              onClose();
              onRetry();
            },
          }}
          onClose={onClose}
          onContact={() => {
            onClose();
            loginUnidentified()
              .then(() => newMessage(t("I can’t sign in. No passkey was found on my device.")))
              .catch(reportError);
          }}
        />
      );
    case "domain":
      return (
        <ErrorDialog
          open={open}
          title={t("Verification failed")}
          description={t(
            "Please check your internet connection and try again in a moment. If the problem persists, reinstalling the app may help.",
          )}
          onClose={onClose}
          onContact={() => {
            onClose();
            loginUnidentified().then(present).catch(reportError);
          }}
        />
      );
  }
}
