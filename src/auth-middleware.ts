import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from './config.js';

export interface AuthUser {
  userId: string;
  username: string;
  role: 'admin' | 'user';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}
