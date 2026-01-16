import "expo-router/entry";
import "./utils/polyfill";

import chain from "@exactly/common/generated/chain";

if (chain.id === 10) chain.name = `Optimism (${chain.name})`;
