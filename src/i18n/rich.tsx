import { Fragment, type ReactNode } from "react";

/**
 * Fills a message's {placeholders} with markup, so translations can put a
 * bold word or a bit of code wherever their grammar needs it:
 *
 *   rich("The answer is {answer}.", { answer: <strong>Mars</strong> })
 *
 * A placeholder with no slot is left as written.
 */
export function rich(message: string, slots: Record<string, ReactNode>): ReactNode {
  return message.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    // The pieces of one sentence never move or change places: their position is their identity.
    // eslint-disable-next-line @eslint-react/no-array-index-key
    return <Fragment key={i}>{name !== undefined && name in slots ? slots[name] : part}</Fragment>;
  });
}
