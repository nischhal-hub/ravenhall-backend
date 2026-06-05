import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../../config/database";
import { AppError } from "../../utils/AppError";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../../utils/jwt";
import { EmailService } from "../notifications/email.service";

const emailService = new EmailService();

export class AuthService {
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) throw new AppError("Email already registered", 409);

    const hashedPassword = await bcrypt.hash(
      data.password,
      Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
    );
    const emailVerifyToken = crypto.randomInt(100000, 999999).toString();

    const user = await prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
        emailVerifyToken,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    await emailService.sendEmailVerification(
      data.email,
      data.firstName,
      emailVerifyToken,
    );
    return user;
  }

  async login(data: { email: string; password: string }) {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new AppError("Invalid email or password", 401);

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) throw new AppError("Invalid email or password", 401);

    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const {
      password: _,
      emailVerifyToken: __,
      resetToken: ___,
      ...safeUser
    } = user;
    return { user: safeUser, accessToken, refreshToken };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({
        where: { userId, token: refreshToken },
      });
    }
  }

  async refreshAccessToken(token: string) {
    if (!token) throw new AppError("Refresh token required", 401);

    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError("Invalid or expired refresh token", 401);
    }

    const payload = verifyRefreshToken(token);
    const accessToken = generateAccessToken({
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    });

    return { accessToken };
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isEmailVerified: true,
        createdAt: true,
        membership: true,
      },
    });
    if (!user) throw new AppError("User not found", 404);
    return user;
  }

  async verifyEmail(token: string) {
    const user = await prisma.user.findFirst({
      where: { emailVerifyToken: token },
    });
    if (!user) throw new AppError("Invalid verification token", 400);

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerifyToken: null },
    });
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return; // Do not reveal whether email exists

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    await emailService.sendPasswordReset(email, user.firstName, resetToken);
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });
    if (!user) throw new AppError("Invalid or expired reset token", 400);

    const hashedPassword = await bcrypt.hash(
      newPassword,
      Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    // Invalidate all refresh tokens on password reset
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  }
  async getFullProfile(userId: string) {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isEmailVerified: true,
        createdAt: true,
        updatedAt: true,

        membership: {
          select: {
            plan: true,
            discountPct: true,
            startDate: true,
            endDate: true,
            isActive: true,
          },
        },

        bookings: {
          orderBy: { createdAt: "desc" },
          include: {
            items: {
              include: {
                slot: {
                  include: {
                    lane: true,
                  },
                },
              },
            },
            payment: true,
            discountCode: {
              select: { code: true, discountPct: true },
            },
          },
        },

        notifications: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
  }
}
