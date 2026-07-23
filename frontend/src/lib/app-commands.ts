export type AppCommand =
  | "open-spotlight"
  | "new-chat"
  | "quick-open-file"
  | "previous-tab"
  | "next-tab"
  | "find-next"
  | "find-previous"
  | "dismiss-view-dialogs";

const APP_COMMAND_EVENT = "hive:app-command";

export function dispatchAppCommand(command: AppCommand): void {
  window.dispatchEvent(new CustomEvent<AppCommand>(APP_COMMAND_EVENT, { detail: command }));
}

export function subscribeAppCommand(command: AppCommand, handler: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<AppCommand>).detail === command) handler();
  };
  window.addEventListener(APP_COMMAND_EVENT, listener);
  return () => window.removeEventListener(APP_COMMAND_EVENT, listener);
}
