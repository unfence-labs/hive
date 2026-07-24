import { useEffect } from "react";
import { subscribeAppCommand, type AppCommand } from "@/lib/app-commands";

export function useAppCommand(command: AppCommand, handler: () => void): void {
  useEffect(() => subscribeAppCommand(command, handler), [command, handler]);
}
