import { createContext } from 'react';

interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);
export { AuthProvider } from './AuthContext.tsx';
export { useAuth } from './useAuth';
