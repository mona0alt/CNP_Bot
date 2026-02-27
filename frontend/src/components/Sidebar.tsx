import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LayoutDashboard, MessageSquare, Terminal } from "lucide-react";

export function Sidebar() {
  const location = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/chats", label: "Chats", icon: MessageSquare },
    // { href: "/logs", label: "Logs", icon: Terminal },
  ];

  return (
    <div className="w-64 border-r border-border h-screen p-4 flex flex-col bg-card">
      <div className="mb-8 px-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Terminal className="w-6 h-6" />
          NanoClaw
        </h1>
      </div>
      <nav className="space-y-2">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = location.pathname === link.href;
          return (
            <Link
              key={link.href}
              to={link.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
