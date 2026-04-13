import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderOpen } from "lucide-react";

import type { SkillTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RenameDialog } from "./RenameDialog";

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
          "group relative flex cursor-pointer items-center gap-2 rounded-lg py-1.5 text-left text-xs transition-all duration-200",
          isActive ? "bg-primary/10 text-foreground ring-1 ring-primary/20" : "hover:bg-muted/80",
          isDropTarget && editable && "bg-blue-500/10 ring-1 ring-blue-400/40",
          isDragSource && editable && "opacity-40",
        )}
        style={{ paddingLeft: `${depth * 20 + 12}px`, paddingRight: "12px" }}
      >
        {/* Indentation guide line */}
        {depth > 0 && (
          <div
            className="absolute bottom-0 top-0 w-px bg-border/40"
            style={{ left: `${(depth - 1) * 20 + 8}px` }}
          />
        )}

        {isDirectory ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded transition-colors hover:bg-muted"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(node.path);
            }}
          >
            {isExpanded ? (
              <ChevronDown size={12} className="text-primary" />
            ) : (
              <ChevronRight size={12} className="text-muted-foreground" />
            )}
          </span>
        ) : (
          <span className="inline-flex h-4 w-4" />
        )}

        {/* File/Folder icon with color coding */}
        <span className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded transition-all duration-200",
          isActive ? "bg-primary/15" : "group-hover:bg-muted",
        )}>
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen size={14} className="text-amber-500" />
            ) : (
              <FolderClosed size={14} className="text-amber-400" />
            )
          ) : (
            <FileText size={14} className="text-sky-400/80" />
          )}
        </span>
        <span className={cn(
          "truncate font-mono text-xs",
          isActive ? "text-foreground font-medium" : "text-muted-foreground"
        )}>
          {node.name}
        </span>
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

  // Dialog state
  const [dialogType, setDialogType] = useState<'file' | 'directory' | 'rename' | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [dialogNode, setDialogNode] = useState<SkillTreeNode | null>(null);

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

  const openFileDialog = (parentPath: string) => {
    setDialogType('file');
    setDialogValue('');
    setDialogNode({ path: parentPath, name: '', type: 'directory' } as SkillTreeNode);
    setContextMenu(null);
  };

  const openDirectoryDialog = (parentPath: string) => {
    setDialogType('directory');
    setDialogValue('');
    setDialogNode({ path: parentPath, name: '', type: 'directory' } as SkillTreeNode);
    setContextMenu(null);
  };

  const openRenameDialog = (node: SkillTreeNode) => {
    const currentName = node.path.split("/").filter(Boolean).at(-1) ?? "";
    setDialogType('rename');
    setDialogValue(currentName);
    setDialogNode(node);
    setContextMenu(null);
  };

  const handleDialogConfirm = async (value: string) => {
    if (!dialogType || !dialogNode) return;

    if (dialogType === 'file') {
      const parentPath = dialogNode.type === 'directory' ? dialogNode.path : getParentPath(dialogNode.path);
      await onCreate(parentPath, 'file', value);
    } else if (dialogType === 'directory') {
      const parentPath = dialogNode.type === 'directory' ? dialogNode.path : getParentPath(dialogNode.path);
      await onCreate(parentPath, 'directory', value);
    } else if (dialogType === 'rename') {
      const parentPath = getParentPath(dialogNode.path);
      await onRename(dialogNode.path, joinPath(parentPath, value));
    }

    setDialogType(null);
    setDialogValue('');
    setDialogNode(null);
  };

  if (!nodes.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 py-12 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-muted-foreground/30">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <p className="text-sm text-muted-foreground/60">暂无技能目录</p>
      </div>
    );
  }

  return (
    <div className="relative py-1">
      <ul className="space-y-1">
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
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          {/* Menu panel */}
          <div
            className="context-menu-panel"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="context-menu-item w-full"
              onClick={() => {
                const parentPath = contextMenu.node.type === "directory"
                  ? contextMenu.node.path
                  : getParentPath(contextMenu.node.path);
                openFileDialog(parentPath);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              新建文件
            </button>
            <button
              type="button"
              className="context-menu-item w-full"
              onClick={() => {
                const parentPath = contextMenu.node.type === "directory"
                  ? contextMenu.node.path
                  : getParentPath(contextMenu.node.path);
                openDirectoryDialog(parentPath);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
              新建目录
            </button>
            <div className="context-menu-separator" />
            <button
              type="button"
              className="context-menu-item w-full"
              onClick={() => openRenameDialog(contextMenu.node)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
              重命名
            </button>
          </div>
        </>
      )}

      {/* Dialogs */}
      <RenameDialog
        open={dialogType === 'file'}
        title="新建文件"
        label="文件名"
        placeholder="请输入文件名"
        initialValue=""
        onConfirm={(name) => handleDialogConfirm(name)}
        onCancel={() => { setDialogType(null); setDialogNode(null); }}
      />
      <RenameDialog
        open={dialogType === 'directory'}
        title="新建目录"
        label="目录名"
        placeholder="请输入目录名"
        initialValue=""
        onConfirm={(name) => handleDialogConfirm(name)}
        onCancel={() => { setDialogType(null); setDialogNode(null); }}
      />
      <RenameDialog
        open={dialogType === 'rename'}
        title="重命名"
        label="新名称"
        placeholder="请输入新名称"
        initialValue={dialogValue}
        onConfirm={(name) => handleDialogConfirm(name)}
        onCancel={() => { setDialogType(null); setDialogNode(null); }}
      />
    </div>
  );
}
