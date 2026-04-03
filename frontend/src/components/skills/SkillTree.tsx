import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderOpen } from "lucide-react";

import type { SkillTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SkillTreeProps {
  nodes: SkillTreeNode[];
  selectedPath: string | null;
  editable: boolean;
  onSelect: (node: SkillTreeNode) => void;
  onOpen: (node: SkillTreeNode) => void;
  onRename: (fromPath: string, toPath: string) => Promise<void> | void;
  onCreate: (
    parentPath: string,
    type: "file" | "directory",
    name: string,
  ) => Promise<void> | void;
  onMove: (fromPath: string, toPath: string) => Promise<void> | void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: SkillTreeNode;
}

interface TreeNodeProps {
  node: SkillTreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  dragSourcePath: string | null;
  dropTargetPath: string | null;
  editable: boolean;
  onSelect: (node: SkillTreeNode) => void;
  onOpen: (node: SkillTreeNode) => void;
  onToggleExpand: (targetPath: string) => void;
  onOpenContextMenu: (event: MouseEvent, node: SkillTreeNode) => void;
  onDragStart: (nodePath: string) => void;
  onDrop: (targetNode: SkillTreeNode) => Promise<void>;
  onDragTarget: (targetPath: string | null) => void;
}

function getParentPath(targetPath: string): string {
  const parts = targetPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

function getDirectories(nodes: SkillTreeNode[]): string[] {
  const result: string[] = [];
  const walk = (items: SkillTreeNode[]) => {
    for (const item of items) {
      if (item.type === "directory") {
        result.push(item.path);
        if (item.children?.length) walk(item.children);
      }
    }
  };
  walk(nodes);
  return result;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  expandedPaths,
  dragSourcePath,
  dropTargetPath,
  editable,
  onSelect,
  onOpen,
  onToggleExpand,
  onOpenContextMenu,
  onDragStart,
  onDrop,
  onDragTarget,
}: TreeNodeProps) {
  const isActive = selectedPath === node.path;
  const isDirectory = node.type === "directory";
  const isExpanded = isDirectory ? expandedPaths.has(node.path) : false;
  const hasChildren = isDirectory && Array.isArray(node.children) && node.children.length > 0;
  const isDragSource = dragSourcePath === node.path;
  const isDropTarget = dropTargetPath === node.path;

  return (
    <li>
      <div
        data-node-path={node.path}
        draggable={editable}
        onClick={() => onSelect(node)}
        onDoubleClick={() => onOpen(node)}
        onContextMenu={(event) => {
          if (!editable) return;
          onOpenContextMenu(event, node);
        }}
        onDragStart={() => {
          if (!editable) return;
          onDragStart(node.path);
        }}
        onDragEnd={() => onDragTarget(null)}
        onDragOver={(event) => {
          if (!editable || !dragSourcePath) return;
          event.preventDefault();
          onDragTarget(node.path);
        }}
        onDragLeave={() => onDragTarget(null)}
        onDrop={async (event) => {
          if (!editable) return;
          event.preventDefault();
          await onDrop(node);
        }}
        className={cn(
          "group relative flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          isActive ? "bg-primary/15 text-foreground ring-1 ring-primary/30" : "hover:bg-muted/70",
          isDropTarget && editable && "bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-950/40",
          isDragSource && editable && "opacity-50",
        )}
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        {isDirectory ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(node.path);
            }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="inline-flex h-4 w-4" />
        )}

        <span className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
          {isDirectory ? (
            isExpanded ? <FolderOpen size={14} /> : <FolderClosed size={14} />
          ) : (
            <FileText size={14} />
          )}
        </span>
        <span className="truncate font-mono">{node.name}</span>
      </div>

      {isDirectory && hasChildren && isExpanded && (
        <ul className="space-y-0.5">
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              dragSourcePath={dragSourcePath}
              dropTargetPath={dropTargetPath}
              editable={editable}
              onSelect={onSelect}
              onOpen={onOpen}
              onToggleExpand={onToggleExpand}
              onOpenContextMenu={onOpenContextMenu}
              onDragStart={onDragStart}
              onDrop={onDrop}
              onDragTarget={onDragTarget}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SkillTree({
  nodes,
  selectedPath,
  editable,
  onSelect,
  onOpen,
  onRename,
  onCreate,
  onMove,
}: SkillTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

  const directoryPaths = useMemo(() => getDirectories(nodes), [nodes]);

  useEffect(() => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const path of directoryPaths) next.add(path);
      return next;
    });
  }, [directoryPaths]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  const handleToggleExpand = (targetPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(targetPath)) next.delete(targetPath);
      else next.add(targetPath);
      return next;
    });
  };

  const handleDrop = async (targetNode: SkillTreeNode) => {
    if (!editable || !dragSourcePath) return;
    const sourceName = dragSourcePath.split("/").filter(Boolean).at(-1) ?? "";
    const targetBasePath =
      targetNode.type === "directory" ? targetNode.path : getParentPath(targetNode.path);
    const nextPath = joinPath(targetBasePath, sourceName);

    setDropTargetPath(null);
    setDragSourcePath(null);

    if (!sourceName || nextPath === dragSourcePath) return;
    if (targetBasePath.startsWith(`${dragSourcePath}/`)) return;
    await onMove(dragSourcePath, nextPath);
  };

  if (!nodes.length) {
    return <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">暂无技能目录</div>;
  }

  return (
    <div className="relative">
      <ul className="space-y-0.5">
        {nodes.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            dragSourcePath={dragSourcePath}
            dropTargetPath={dropTargetPath}
            editable={editable}
            onSelect={onSelect}
            onOpen={onOpen}
            onToggleExpand={handleToggleExpand}
            onOpenContextMenu={(event, menuNode) => {
              if (!editable) return;
              event.preventDefault();
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                node: menuNode,
              });
            }}
            onDragStart={setDragSourcePath}
            onDrop={handleDrop}
            onDragTarget={setDropTargetPath}
          />
        ))}
      </ul>

      {contextMenu && editable && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              const parentPath =
                contextMenu.node.type === "directory"
                  ? contextMenu.node.path
                  : getParentPath(contextMenu.node.path);
              const name = window.prompt("请输入文件名");
              setContextMenu(null);
              if (!name) return;
              void onCreate(parentPath, "file", name.trim());
            }}
          >
            新建文件
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              const parentPath =
                contextMenu.node.type === "directory"
                  ? contextMenu.node.path
                  : getParentPath(contextMenu.node.path);
              const name = window.prompt("请输入目录名");
              setContextMenu(null);
              if (!name) return;
              void onCreate(parentPath, "directory", name.trim());
            }}
          >
            新建目录
          </button>
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              const currentName = contextMenu.node.path.split("/").filter(Boolean).at(-1) ?? "";
              const parentPath = getParentPath(contextMenu.node.path);
              const nextName = window.prompt("请输入新名称", currentName)?.trim();
              setContextMenu(null);
              if (!nextName || nextName === currentName) return;
              void onRename(contextMenu.node.path, joinPath(parentPath, nextName));
            }}
          >
            重命名
          </button>
        </div>
      )}
    </div>
  );
}
