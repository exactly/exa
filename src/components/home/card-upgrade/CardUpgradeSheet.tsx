import { X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView } from "tamagui";

import ActivateCard from "./ActivateCard";
import Intro from "./Intro";
import UpgradeAccount from "./UpgradeAccount";
import VerifyIdentity from "./VerifyIdentity";
import queryClient from "../../../utils/queryClient";
import ModalSheet from "../../shared/ModalSheet";
import SafeView from "../../shared/SafeView";
import View from "../../shared/View";

export default function CardUpgradeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: step } = useQuery<number | undefined>({ queryKey: ["card-upgrade"] });
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <SafeView
        paddingTop={0}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
          <Pressable onPress={onClose} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          {step === undefined ? (
            <Intro
              onPress={() => {
                queryClient.setQueryData(["card-upgrade"], 0);
              }}
            />
          ) : (
            <Step step={step} />
          )}
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

const components = [VerifyIdentity, UpgradeAccount, ActivateCard];

function Step({ step }: { step: number }) {
  return React.createElement(components[step] as React.ComponentType);
}
