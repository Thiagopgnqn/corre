import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { env } from '../../config/env.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 minutos
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 días

function setAuthCookies(res: Response, accessToken: string, refreshToken?: string | null) {
  res.cookie('accessToken', accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });

  if (refreshToken) {
    res.cookie('refreshToken', refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }
}

function clearAuthCookies(res: Response) {
  res.clearCookie('accessToken', COOKIE_OPTIONS);
  res.clearCookie('refreshToken', COOKIE_OPTIONS);
}

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, accessToken, refreshToken, emailDeliveryFailed } =
        await AuthService.register(req.body);
      setAuthCookies(res, accessToken, refreshToken);
      res.status(201).json({
        success: true,
        user,
        emailDeliveryFailed,
      });
    } catch (error) {
      next(error);
    }
  }

  static async google(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, accessToken, refreshToken } = await AuthService.googleAuth(req.body);
      setAuthCookies(res, accessToken, refreshToken);
      res.json({
        success: true,
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { user, accessToken, refreshToken } = await AuthService.login(req.body);
      setAuthCookies(res, accessToken, refreshToken);
      res.json({
        success: true,
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'No autenticado' });
        return;
      }
      const { user, accessToken, refreshToken } = await AuthService.verifyEmail(
        req.user.id,
        req.body.code
      );
      setAuthCookies(res, accessToken, refreshToken);
      res.json({
        success: true,
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  static async resendCode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'No autenticado' });
        return;
      }
      const result = await AuthService.resendVerificationCode(req.user.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async cancelRegistration(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'No autenticado' });
        return;
      }
      const result = await AuthService.cancelRegistration(req.user.id);
      clearAuthCookies(res);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const incomingRefreshToken = req.cookies?.refreshToken;
      const { user, accessToken, refreshToken: newRefreshToken } =
        await AuthService.refresh(incomingRefreshToken);

      setAuthCookies(res, accessToken, newRefreshToken);
      res.json({
        success: true,
        user,
      });
    } catch (error) {
      clearAuthCookies(res);
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const incomingRefreshToken = req.cookies?.refreshToken;
      await AuthService.logout(incomingRefreshToken);
      clearAuthCookies(res);
      res.json({
        success: true,
        message: 'Sesión cerrada correctamente',
      });
    } catch (error) {
      clearAuthCookies(res);
      next(error);
    }
  }

  static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'No autenticado' });
        return;
      }
      const user = await AuthService.getMe(req.user.id);
      res.json({
        success: true,
        user,
      });
    } catch (error) {
      next(error);
    }
  }
}

