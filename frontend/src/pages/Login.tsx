import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import {
  ArrowRight,
  Bot,
  LockKeyhole,
  Moon,
  Sun,
  User,
} from 'lucide-react';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(59,130,246,0.16),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(14,165,233,0.12),transparent_35%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.08)_0%,transparent_30%,rgba(15,23,42,0.22)_100%)] opacity-80" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />

      <div className="relative flex min-h-screen w-full flex-col px-6 py-8 lg:px-12 lg:py-10 2xl:px-20">
        <header className="flex items-center justify-between">
          <div className="inline-flex items-center gap-3 rounded-full border border-border/70 bg-card/70 px-4 py-2 shadow-sm backdrop-blur-xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="font-brand text-sm font-semibold tracking-[0.18em] text-foreground/90 uppercase">
                CNP-Bot
              </p>
              <p className="text-xs text-muted-foreground">Container Operations Intelligence</p>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-card/70 px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-xl transition-colors duration-200 hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </header>

        <main className="flex flex-1 items-center py-8 lg:py-0">
          <div className="grid w-full flex-1 gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(500px,560px)] lg:gap-24 xl:gap-32">
            <section className="flex flex-col justify-center lg:pr-10 xl:pr-16">
              <div className="max-w-4xl space-y-8 lg:space-y-10">
                <div className="space-y-6">
                  <h1 className="font-brand text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:max-w-5xl lg:text-[4.8rem] lg:leading-[1.02] xl:text-[5.4rem]">
                    Professional access to your container operations control plane.
                  </h1>
                  <p className="max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl sm:leading-9">
                    A quiet, focused workspace for container-native AI operations.
                  </p>
                </div>
                <div className="flex items-center gap-4 pt-4 text-sm text-muted-foreground/90">
                  <div className="h-px w-20 bg-border" />
                  <p>Designed for clarity and control.</p>
                </div>
              </div>
            </section>

            <section className="relative flex items-center justify-end">
              <div className="w-full max-w-[560px] rounded-[2.25rem] border border-white/10 bg-card/72 p-8 shadow-[0_40px_140px_-56px_rgba(2,6,23,0.92)] backdrop-blur-[28px] sm:p-11">
                <div className="mb-12 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-primary/80">Login</p>
                    <h2 className="font-brand mt-4 text-3xl font-semibold tracking-tight sm:text-[2.1rem]">
                      Sign in to CNP-Bot
                    </h2>
                    <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground">
                      Continue to your operational workspace.
                    </p>
                  </div>
                  <div className="hidden rounded-2xl border border-white/10 bg-background/40 p-3 text-primary/90 shadow-sm sm:block">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-7">
                  {error && (
                    <div
                      role="alert"
                      className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
                    >
                      {error}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="username" className="block text-sm font-medium">
                      Username
                    </label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="h-14 w-full rounded-2xl border border-white/10 bg-background/55 pl-11 pr-4 text-base shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-200 placeholder:text-muted-foreground/80 hover:border-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
                        placeholder="Enter your operator account"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="password" className="block text-sm font-medium">
                      Password
                    </label>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-14 w-full rounded-2xl border border-white/10 bg-background/55 pl-11 pr-4 text-base shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-200 placeholder:text-muted-foreground/80 hover:border-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
                        placeholder="Enter your password"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-[0_20px_50px_-20px_hsla(var(--primary)/0.55)] transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
                  >
                    <span>{isLoading ? 'Signing in...' : 'Enter Workspace'}</span>
                    {!isLoading && <ArrowRight className="h-4 w-4" />}
                  </button>
                </form>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
