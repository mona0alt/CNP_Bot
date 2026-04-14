import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Key, LogOut, Moon, Sun, User } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

type PageMeta = {
  title: string;
  description: string;
};

const PAGE_META: PageMeta[] = [
  { title: "控制台", description: "查看平台态势、任务与资源概况" },
  { title: "会话", description: "统一管理智能会话与运行状态" },
  { title: "知识库", description: "浏览、搜索并维护知识内容" },
  { title: "技能", description: "管理技能资产与工作区内容" },
  { title: "用户管理", description: "维护账户、角色与访问权限" },
  { title: "设置", description: "配置平台服务依赖与运行参数" },
];

function resolvePageMeta(pathname: string): PageMeta {
  if (pathname === "/") return PAGE_META[0];
  if (pathname.startsWith("/chats")) return PAGE_META[1];
  if (pathname.startsWith("/kb")) return PAGE_META[2];
  if (pathname.startsWith("/skills")) return PAGE_META[3];
  if (pathname.startsWith("/users")) return PAGE_META[4];
  if (pathname.startsWith("/settings")) return PAGE_META[5];
  return { title: "工作区", description: "当前页面" };
}

export function Topbar() {
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

  const pageMeta = useMemo(() => resolvePageMeta(location.pathname), [location.pathname]);
  const isDark = theme === "dark";
  const themeAriaLabel = isDark ? "切换到浅色模式" : "切换到深色模式";
  const showPageDescription = !location.pathname.startsWith("/chats") && pageMeta.description.length > 0;

  const handleLogout = async () => {
    setShowUserMenu(false);
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
      window.setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess(false);
      }, 1500);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const resetPasswordModal = () => {
    setShowPasswordModal(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordSuccess(false);
  };

  return (
    <>
      <header className="relative z-30 h-14 shrink-0 border-b border-border/80 bg-background/92 px-4 backdrop-blur-xl sm:px-5 lg:px-6">
        <div className="flex h-full items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                {pageMeta.title}
              </h1>
              <p className="hidden truncate text-sm text-muted-foreground lg:block">
                {showPageDescription ? pageMeta.description : ""}
              </p>
            </div>
          </div>

          <div className="relative z-40 flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={themeAriaLabel}
              title={themeAriaLabel}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-border/70 bg-card/70 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="relative">
              <button
                type="button"
                aria-label="打开用户菜单"
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
                onClick={() => setShowUserMenu((prev) => !prev)}
                className="inline-flex h-10 max-w-[220px] cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-card/80 px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <User className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block truncate">{user?.display_name || user?.username}</span>
                </span>
              </button>

              {showUserMenu && (
                <div
                  data-testid="topbar-user-menu"
                  className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 overflow-hidden rounded-xl border bg-popover shadow-2xl ring-1 ring-black/5"
                >
                  <div className="border-b px-4 py-3 text-xs text-muted-foreground">
                    {user?.role === "admin" ? "管理员" : "普通用户"}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowPasswordModal(true);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted"
                  >
                    <Key className="h-4 w-4" />
                    修改密码
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-red-500 transition-colors hover:bg-muted"
                  >
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-background p-6">
            <h2 className="text-xl font-bold">修改密码</h2>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {passwordError && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-500 dark:bg-red-950">
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-500 dark:bg-green-950">
                  密码修改成功
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">当前密码</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                  minLength={6}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetPasswordModal}
                  className="flex-1 rounded-md border px-4 py-2 transition-colors hover:bg-muted"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="flex-1 rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isChangingPassword ? "提交中..." : "确认修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
