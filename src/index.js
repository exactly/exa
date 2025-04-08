import "./utils/polyfill";
import "expo-router/entry";

import chain from "@exactly/common/generated/chain";

if (chain.id === 10) chain.name = `Optimism (${chain.name})`;
