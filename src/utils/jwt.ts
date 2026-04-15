import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";

interface TokenPayload {
  userId: string;
  email: string;
  role: Role;
}

export const generateAccessToken = (payload: TokenPayload): string => {
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ||
    "15m") as jwt.SignOptions["expiresIn"];

  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn,
  });
};

export const generateRefreshToken = (payload: TokenPayload): string => {
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ||
    "7d") as jwt.SignOptions["expiresIn"];

  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn,
  });
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as TokenPayload;
};
