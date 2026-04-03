import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  Users,
  LogOut,
  Key,
  User,
  Sun,
  Moon,
} from "lucide-react";

export function Sidebar() {
  const location = useLocation();
  const { user, logout, changePassword } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const links = [
    { href: "/", label: "控制台", icon: LayoutDashboard },
    { href: "/chats", label: "会话", icon: MessageSquare },
    { href: "/skills", label: "技能", icon: Sparkles },
    ...(user?.role === "admin" ? [{ href: "/users", label: "用户管理", icon: Users }] : []),
  ];

  const handleLogout = async () => {
    await logout();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的密码不一致");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError("密码长度不能少于 6 位");
      return;
    }

    setIsChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(false);
      }, 1500);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="w-64 border-r border-border h-screen flex flex-col bg-card">
      <div className="h-[60px] flex items-center px-6 border-b shrink-0">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          CNP-Bot
        </h1>
      </div>
      <div className="flex-1 flex flex-col p-4 overflow-y-auto">
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

        {/* Theme toggle */}
        <div className="mt-4 pt-4 border-t">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
          </button>
        </div>

        {/* User section at bottom */}
        <div className="mt-auto pt-4 border-t">
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <User className="w-4 h-4" />
              <span className="flex-1 text-left truncate">
                {user?.display_name || user?.username}
              </span>
            </button>

            {showUserMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-popover border rounded-md shadow-lg overflow-hidden">
                <div className="px-4 py-2 text-xs text-muted-foreground border-b">
                  {user?.role === "admin" ? "管理员" : "普通用户"}
                </div>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowPasswordModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <Key className="w-4 h-4" />
                  修改密码
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-500 hover:bg-muted transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background p-6 rounded-lg w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold">修改密码</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {passwordError && (
                <div className="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="p-3 text-sm text-green-500 bg-green-50 dark:bg-green-950 rounded-md">
                  密码修改成功
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">当前密码</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                  minLength={6}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setPasswordError("");
                  }}
                  className="flex-1 py-2 px-4 border rounded-md hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isChangingPassword ? "提交中..." : "确认修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
