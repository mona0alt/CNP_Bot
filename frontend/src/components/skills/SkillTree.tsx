import type { SkillTreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SkillTreeProps {
  nodes: SkillTreeNode[];
  selectedPath: string | null;
  onSelect: (node: SkillTreeNode) => void;
}

interface TreeNodeProps {
  node: SkillTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: SkillTreeNode) => void;
}

function TreeNode({ node, depth, selectedPath, onSelect }: TreeNodeProps) {
  const isActive = selectedPath === node.path;
  const hasChildren = node.type === "directory" && Array.isArray(node.children) && node.children.length > 0;
  const paddingLeft = `${depth * 12 + 8}px`;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={cn(
          "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted",
        )}
        style={{ paddingLeft }}
      >
        <span className="font-mono">
          {node.type === "directory" ? "[D] " : "[F] "}
          {node.name}
        </span>
      </button>
      {hasChildren && (
        <ul className="mt-1 space-y-1">
          {node.children!.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SkillTree({ nodes, selectedPath, onSelect }: SkillTreeProps) {
  if (!nodes.length) {
    return <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">暂无技能目录</div>;
  }

  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
