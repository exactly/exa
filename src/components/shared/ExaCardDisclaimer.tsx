import React from "react";

import Text from "./Text";

export default function ExaCardDisclaimer(properties: Parameters<typeof Text>[0]) {
  return (
    <Text color="$interactiveOnDisabled" caption textAlign="justify" {...properties}>
      *The Exa Card is issued by Third National pursuant to a license from Visa. Any credit issued by Exactly Protocol
      subject to its separate terms and conditions. Third National is not a party to any agreement with Exactly Protocol
      and is not responsible for any loan or credit arrangement between user and Exactly Protocol.
    </Text>
  );
}
