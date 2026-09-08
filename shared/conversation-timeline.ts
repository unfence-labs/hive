/** Ordered first occurrences within an assistant turn. Entity payloads stay in
 * their existing collections; text belongs to its provider block. */
export type ConversationTimelineEntry =
  | { type: "text"; id: string; text: string }
  | { type: "reasoning"; id: string }
  | { type: "tool"; id: string }
  | { type: "activity"; id: string };
