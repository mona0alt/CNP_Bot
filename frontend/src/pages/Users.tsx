import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

interface UserData {
  id: string;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

export function Users() {
  const { token, logout } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserData | null>(null);

  // Form state
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'user'>('user');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formError, setFormError] = useState('');

  const handleUnauthorized = useCallback(async () => {
    await logout();
    window.location.href = "/login";
  }, [logout]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  }, [token, handleUnauthorized]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openModal = (user?: UserData) => {
    if (user) {
      setEditingUser(user);
      setFormUsername(user.username);
      setFormPassword('');
      setFormRole(user.role);
      setFormDisplayName(user.display_name || '');
    } else {
      setEditingUser(null);
      setFormUsername('');
      setFormPassword('');
      setFormRole('user');
      setFormDisplayName('');
    }
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormUsername('');
    setFormPassword('');
    setFormRole('user');
    setFormDisplayName('');
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!editingUser && !formPassword) {
      setFormError('Password is required');
      return;
    }

    try {
      const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
      const method = editingUser ? 'PUT' : 'POST';

      const body: Record<string, unknown> = {
        username: formUsername,
        role: formRole,
        display_name: formDisplayName || undefined,
      };

      if (formPassword) {
        body.password = formPassword;
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Operation failed' }));
        throw new Error(err.error || 'Operation failed');
      }

      closeModal();
      fetchUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Operation failed');
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;

    try {
      const res = await fetch(`/api/users/${deleteUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401 || res.status === 403) {
        await handleUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(err.error || 'Delete failed');
      }

      setDeleteUser(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <button
          onClick={() => openModal()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="border rounded-md">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-4 text-left text-sm font-medium">Username</th>
              <th className="p-4 text-left text-sm font-medium">Display Name</th>
              <th className="p-4 text-left text-sm font-medium">Role</th>
              <th className="p-4 text-left text-sm font-medium">Last Login</th>
              <th className="p-4 text-right text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b last:border-0">
                <td className="p-4 text-sm">{user.username}</td>
                <td className="p-4 text-sm">{user.display_name || '-'}</td>
                <td className="p-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      user.role === 'admin'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="p-4 text-sm text-muted-foreground">
                  {formatDate(user.last_login)}
                </td>
                <td className="p-4 text-right">
                  <button
                    onClick={() => openModal(user)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-muted"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteUser(user)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-muted"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="w-full max-w-md space-y-5 rounded-lg bg-background p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">
                {editingUser ? 'Edit User' : 'Add User'}
              </h2>
              <button onClick={closeModal} className="rounded-md p-2 transition-colors hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {formError && (
                <div className="rounded-md bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium">Username</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  className="h-11 w-full rounded-md border bg-background px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Password {editingUser && '(leave empty to keep current)'}
                </label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="h-11 w-full rounded-md border bg-background px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  required={!editingUser}
                  minLength={6}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Display Name</label>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="h-11 w-full rounded-md border bg-background px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Role</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as 'admin' | 'user')}
                  className="h-11 w-full rounded-md border bg-background px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="h-11 flex-1 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-11 flex-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {editingUser ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteUser}
        title="Delete User"
        message={`Are you sure you want to delete user "${deleteUser?.username}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteUser(null)}
        destructive
      />
    </div>
  );
}
