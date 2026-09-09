import {
  AlertTriangleIcon,
  BotIcon,
  BrainIcon,
  CornerDownRightIcon,
  FileIcon,
  FileTextIcon,
  FoldVerticalIcon,
  GlobeIcon,
  ImageIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  MessageSquareTextIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { StepIcon } from "@/lib/timeline-steps";

const ICONS: Record<StepIcon, LucideIcon> = {
  file: FileIcon,
  pencil: PencilIcon,
  terminal: TerminalIcon,
  search: SearchIcon,
  globe: GlobeIcon,
  bot: BotIcon,
  listChecks: ListChecksIcon,
  wrench: WrenchIcon,
  brain: BrainIcon,
  question: MessageCircleQuestionIcon,
  plan: FileTextIcon,
  image: ImageIcon,
  fold: FoldVerticalIcon,
  alert: AlertTriangleIcon,
  prompt: MessageSquareTextIcon,
  result: CornerDownRightIcon,
};

export function StepIconGlyph({ icon, className }: { icon: StepIcon; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden="true" />;
}
