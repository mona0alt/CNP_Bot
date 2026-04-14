import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  BookOpen,
  MessageSquare,
  Sparkles,
  Users,
  Bot,
  Settings,
} from "lucide-react";

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();

  const mainLinks = [
    { href: "/", label: "控制台", icon: LayoutDashboard },
    { href: "/chats", label: "会话", icon: MessageSquare },
    { href: "/kb", label: "知识库", icon: BookOpen },
    { href: "/skills", label: "技能", icon: Sparkles },
  ];

  const bottomLinks = [
    ...(user?.role === "admin" ? [{ href: "/users", label: "用户管理", icon: Users }] : []),
    { href: "/settings", label: "设置", icon: Settings },
  ];

  return (
    <aside
      className="flex h-full w-56 shrink-0 flex-col border-r border-border/80 bg-card/90 backdrop-blur-xl"
      data-sidebar-size="wide"
    >
      <div className="flex h-14 items-center border-b border-border/80 px-3 shrink-0">
        <h1 className="font-brand flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <span className="truncate">CNP-Bot</span>
        </h1>
      </div>
      <div className="flex flex-1 flex-col p-2 overflow-y-auto">
        <nav className="space-y-0.5" data-nav-scale="readable">
          {mainLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.href;
            return (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "app-control flex items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="shrink-0 border-t border-border/60 p-2">
        <nav className="space-y-0.5">
          {bottomLinks.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.href;
            return (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "app-control flex items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
