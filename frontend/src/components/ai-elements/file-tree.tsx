"use client";

import type { HTMLAttributes, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import {
  FileIcon as SymbolFileIcon,
  FolderIcon as SymbolFolderIcon,
} from "@react-symbols/icons/utils";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { WorkspaceFileTreeNode } from "@/types";

const fileTreeRowClass =
  "relative grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-1 rounded py-1 pr-2 text-left transition-colors hover:bg-muted/50";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onPathSelect?: (path: string) => void;
}

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onPathSelect?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onPathSelect,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onPathSelect, selectedPath, togglePath }),
    [expandedPaths, onPathSelect, selectedPath, togglePath]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          "font-mono text-xs",
          className
        )}
        role="tree"
        {...props}
      >
        {children}
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeFolderContextType {
  path: string;
  name: string;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
};

export const FileTreeFolder = ({
  path,
  name,
  className,
  children,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath } = useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);

  const handleOpenChange = useCallback(() => {
    togglePath(path);
  }, [togglePath, path]);

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path]
  );

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleOpenChange} open={isExpanded}>
        <div
          className={cn("", className)}
          role="treeitem"
          tabIndex={0}
          {...props}
        >
          <CollapsibleTrigger asChild>
            <button
              className={cn("-ml-5 w-[calc(100%+1.25rem)] pl-7", fileTreeRowClass)}
              type="button"
            >
              <ChevronRightIcon
                className={cn(
                  "absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
              <FileTreeIcon>
                <SymbolFolderIcon folderName={name} className="size-4" />
              </FileTreeIcon>
              <FileTreeName>{name}</FileTreeName>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-4 border-l pl-2">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  className,
  children,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onPathSelect } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const handleClick = useCallback(() => {
    onPathSelect?.(path);
  }, [onPathSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onPathSelect?.(path);
      }
    },
    [onPathSelect, path]
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      <div
        className={cn(
          "cursor-pointer",
          fileTreeRowClass,
          "pl-2",
          isSelected && "bg-muted",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        tabIndex={0}
        {...props}
      >
        {children ?? (
          <>
            <FileTreeIcon>
              {icon ?? <SymbolFileIcon fileName={name} autoAssign className="size-4" />}
            </FileTreeIcon>
            <FileTreeName>{name}</FileTreeName>
          </>
        )}
      </div>
    </FileTreeFileContext.Provider>
  );
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span
    className={cn(
      "flex size-4 shrink-0 items-center justify-center overflow-hidden [&>svg]:size-4 [&>svg]:shrink-0",
      className
    )}
    {...props}
  >
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  <span className={cn("min-w-0 truncate", className)} {...props}>
    {children}
  </span>
);

/**
 * Render a recursive {@link WorkspaceFileTreeNode} array into the shared
 * read-only {@link FileTree} primitives (folders + files). Shared by
 * WorkspaceView and BrainView so both render their file trees identically;
 * selection/expansion is owned by the surrounding {@link FileTree}.
 */
export function renderFileTreeNodes(nodes: WorkspaceFileTreeNode[]): ReactNode {
  return nodes.map((node) => {
    const nodePath = node.path;
    if (node.type === "directory") {
      return (
        <FileTreeFolder key={nodePath} path={nodePath} name={node.name}>
          {node.children ? renderFileTreeNodes(node.children) : null}
        </FileTreeFolder>
      );
    }
    return <FileTreeFile key={nodePath} path={nodePath} name={node.name} />;
  });
}

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation required for nested interactions
  // biome-ignore lint/a11y/useSemanticElements: fieldset doesn't fit this UI pattern
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
