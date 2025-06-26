import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      role?: "admin" | "user" | "developer" | null;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role?: "admin" | "user" | "developer" | null;
  }
}