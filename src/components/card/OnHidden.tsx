import { useEffect } from "react";

import { newMessage } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";

export default function OnHidden({ message }: { message: { current: null | string } }) {
  useEffect(() => {
    return () => {
      const text = message.current;
      if (text === null) return;
      message.current = null;
      newMessage(text)
        .then((presented) => {
          if (presented) queryClient.setQueryData<boolean>(["settings", "card-support-contacted"], true);
        })
        .catch(reportError);
    };
  }, [message]);
  return null;
}
