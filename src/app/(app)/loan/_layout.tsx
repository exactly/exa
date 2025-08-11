import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function LoanLayout() {
  useBackgroundColor();
  return <Stack screenOptions={{ headerShown: false }} />;
}

export type LoanNavigationProperties = NativeStackNavigationProp<LoanParameterList>;
export interface LoanParameterList extends ParamListBase {
  index: undefined;
  amount: undefined;
  installments: undefined;
  maturity: undefined;
  receiver: undefined;
  review: undefined;
}
