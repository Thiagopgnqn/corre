import crypto from 'crypto';
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  emailVerificationCodes,
  refreshTokens,
  userIdentities,
  users,
  userSettings,
} from '../../db/schema.js';

export interface AuthUserRecord {
  id: string;
  email: string;
  canonicalEmail: string | null;
  passwordHash: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  selectedPlanId: string | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuthRefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  revokedAt: Date | null;
  replacedByHash: string | null;
  expiresAt: Date;
}

export interface AuthVerificationCodeRecord {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface GeneratedSessionPayload {
  accessToken: string;
  rawRefreshToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface GoogleSessionResult {
  user: {
    id: string;
    email: string;
    role: string;
    selectedPlanId: string | null;
    emailVerified: true;
  };
  accessToken: string;
  refreshToken: string;
}

export type SessionGenerator = (user: {
  id: string;
  email: string;
  role: 'user' | 'admin';
  selectedPlanId: string | null;
}) => GeneratedSessionPayload;

export interface AuthStore {
  findGoogleIdentityByProviderUserId(providerUserId: string): Promise<{ id: string; userId: string } | null>;
  findUserById(userId: string): Promise<AuthUserRecord | null>;
  findUserByCanonicalOrEmail(canonicalEmail: string, rawEmailLower: string): Promise<AuthUserRecord | null>;
  findUserByCanonicalEmail(canonicalEmail: string): Promise<AuthUserRecord | null>;
  findUserGoogleIdentity(userId: string): Promise<{ id: string } | null>;
  listUserIdentityProviders(userId: string): Promise<string[]>;
  insertGoogleIdentity(userId: string, providerUserId: string): Promise<void>;
  updateUserFields(
    userId: string,
    patch: Partial<Pick<AuthUserRecord, 'canonicalEmail' | 'selectedPlanId' | 'emailVerifiedAt' | 'lastLoginAt'>>
  ): Promise<void>;
  createGoogleUserWithRefreshToken(params: {
    replaceExistingUserId?: string;
    email: string;
    canonicalEmail: string;
    selectedPlanId: string | null;
    providerUserId: string;
    generateSession: SessionGenerator;
  }): Promise<GoogleSessionResult>;
  preserveUnverifiedUserWithGoogle(params: {
    userId: string;
    canonicalEmail: string;
    selectedPlanId: string | null;
    providerUserId: string;
    generateSession: SessionGenerator;
  }): Promise<GoogleSessionResult>;
  insertRefreshToken(params: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findRefreshTokenByHash(tokenHash: string): Promise<AuthRefreshTokenRecord | null>;
  revokeRefreshToken(tokenId: string): Promise<void>;
  revokeAllUserRefreshTokens(userId: string): Promise<void>;
  rotateRefreshToken(params: {
    oldTokenId: string;
    userId: string;
    newHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findLatestVerificationCode(userId: string, onlyUnexpired?: boolean): Promise<AuthVerificationCodeRecord | null>;
  consumeVerificationCode(codeId: string): Promise<void>;
  incrementVerificationAttempts(codeId: string, nextAttempts: number, consumedAt: Date | null): Promise<void>;
  createVerificationCode(params: { userId: string; codeHash: string; expiresAt: Date }): Promise<void>;
  completeEmailVerification(params: {
    codeId: string;
    userId: string;
    selectedPlanId?: string | null;
  }): Promise<void>;
  logoutByTokenHash(tokenHash: string): Promise<void>;
}

function mapUserRow(row: typeof users.$inferSelect): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    canonicalEmail: row.canonicalEmail ?? null,
    passwordHash: row.passwordHash ?? null,
    role: row.role as 'user' | 'admin',
    status: row.status as 'active' | 'suspended',
    selectedPlanId: row.selectedPlanId ?? null,
    emailVerifiedAt: row.emailVerifiedAt ?? null,
    lastLoginAt: row.lastLoginAt ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleAuthStore implements AuthStore {
  async findGoogleIdentityByProviderUserId(providerUserId: string) {
    const [row] = await db
      .select({ id: userIdentities.id, userId: userIdentities.userId })
      .from(userIdentities)
      .where(
        and(eq(userIdentities.provider, 'google'), eq(userIdentities.providerUserId, providerUserId))
      )
      .limit(1);
    return row || null;
  }

  async findUserById(userId: string) {
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ? mapUserRow(row) : null;
  }

  async findUserByCanonicalOrEmail(canonicalEmail: string, rawEmailLower: string) {
    const [row] = await db
      .select()
      .from(users)
      .where(or(eq(users.canonicalEmail, canonicalEmail), eq(users.email, rawEmailLower)))
      .limit(1);
    return row ? mapUserRow(row) : null;
  }

  async findUserByCanonicalEmail(canonicalEmail: string) {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.canonicalEmail, canonicalEmail))
      .limit(1);
    return row ? mapUserRow(row) : null;
  }

  async findUserGoogleIdentity(userId: string) {
    const [row] = await db
      .select({ id: userIdentities.id })
      .from(userIdentities)
      .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, 'google')))
      .limit(1);
    return row || null;
  }

  async listUserIdentityProviders(userId: string) {
    const rows = await db
      .select({ provider: userIdentities.provider })
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId));
    return rows.map((r) => r.provider);
  }

  async insertGoogleIdentity(userId: string, providerUserId: string) {
    await db.insert(userIdentities).values({
      userId,
      provider: 'google',
      providerUserId,
    });
  }

  async updateUserFields(
    userId: string,
    patch: Partial<Pick<AuthUserRecord, 'canonicalEmail' | 'selectedPlanId' | 'emailVerifiedAt' | 'lastLoginAt'>>
  ) {
    await db
      .update(users)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async createGoogleUserWithRefreshToken(params: {
    replaceExistingUserId?: string;
    email: string;
    canonicalEmail: string;
    selectedPlanId: string | null;
    providerUserId: string;
    generateSession: SessionGenerator;
  }): Promise<GoogleSessionResult> {
    if (params.replaceExistingUserId) {
      await db.delete(users).where(eq(users.id, params.replaceExistingUserId));
    }

    return await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          email: params.email,
          canonicalEmail: params.canonicalEmail,
          passwordHash: null,
          role: 'user',
          selectedPlanId: params.selectedPlanId,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          role: users.role,
          selectedPlanId: users.selectedPlanId,
        });

      if (params.selectedPlanId) {
        await tx.insert(userSettings).values({
          userId: newUser.id,
          planId: params.selectedPlanId,
          includePromotionsInGPA: true,
          minPassingGrade: 4,
          includeAnalistaTrack: false,
          allowBlockedElectivesPlanning: false,
          includeElectivesInProgress: true,
          soundEnabled: true,
          tutorialCompleted: false,
        });
      }

      await tx.insert(userIdentities).values({
        userId: newUser.id,
        provider: 'google',
        providerUserId: params.providerUserId,
      });

      const session = params.generateSession({
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as 'user' | 'admin',
        selectedPlanId: newUser.selectedPlanId,
      });

      await tx.insert(refreshTokens).values({
        userId: newUser.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      });

      return {
        user: {
          ...newUser,
          emailVerified: true,
        },
        accessToken: session.accessToken,
        refreshToken: session.rawRefreshToken,
      };
    });
  }

  async preserveUnverifiedUserWithGoogle(params: {
    userId: string;
    canonicalEmail: string;
    selectedPlanId: string | null;
    providerUserId: string;
    generateSession: SessionGenerator;
  }): Promise<GoogleSessionResult> {
    return await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: null,
          emailVerifiedAt: new Date(),
          canonicalEmail: params.canonicalEmail,
          selectedPlanId: params.selectedPlanId,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, params.userId));

      await tx
        .update(refreshTokens)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(refreshTokens.userId, params.userId));

      await tx
        .update(emailVerificationCodes)
        .set({
          consumedAt: new Date(),
        })
        .where(eq(emailVerificationCodes.userId, params.userId));

      const [existingGoogleIdent] = await tx
        .select({ id: userIdentities.id })
        .from(userIdentities)
        .where(and(eq(userIdentities.userId, params.userId), eq(userIdentities.provider, 'google')))
        .limit(1);

      if (!existingGoogleIdent) {
        await tx.insert(userIdentities).values({
          userId: params.userId,
          provider: 'google',
          providerUserId: params.providerUserId,
        });
      }

      if (params.selectedPlanId) {
        const [settings] = await tx
          .select({ userId: userSettings.userId })
          .from(userSettings)
          .where(eq(userSettings.userId, params.userId))
          .limit(1);

        if (!settings) {
          await tx.insert(userSettings).values({
            userId: params.userId,
            planId: params.selectedPlanId,
            includePromotionsInGPA: true,
            minPassingGrade: 4,
            includeAnalistaTrack: false,
            allowBlockedElectivesPlanning: false,
            includeElectivesInProgress: true,
            soundEnabled: true,
            tutorialCompleted: false,
          });
        }
      }

      const [freshUser] = await tx
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1);

      const session = params.generateSession({
        id: freshUser.id,
        email: freshUser.email,
        role: freshUser.role as 'user' | 'admin',
        selectedPlanId: params.selectedPlanId,
      });

      await tx.insert(refreshTokens).values({
        userId: freshUser.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      });

      return {
        user: {
          id: freshUser.id,
          email: freshUser.email,
          role: freshUser.role,
          selectedPlanId: params.selectedPlanId,
          emailVerified: true,
        },
        accessToken: session.accessToken,
        refreshToken: session.rawRefreshToken,
      };
    });
  }

  async insertRefreshToken(params: { userId: string; tokenHash: string; expiresAt: Date }) {
    await db.insert(refreshTokens).values(params);
  }

  async findRefreshTokenByHash(tokenHash: string) {
    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row
      ? {
          id: row.id,
          userId: row.userId,
          tokenHash: row.tokenHash,
          revokedAt: row.revokedAt ?? null,
          replacedByHash: row.replacedByHash ?? null,
          expiresAt: row.expiresAt,
        }
      : null;
  }

  async revokeRefreshToken(tokenId: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(refreshTokens.id, tokenId));
  }

  async revokeAllUserRefreshTokens(userId: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(refreshTokens.userId, userId));
  }

  async rotateRefreshToken(params: {
    oldTokenId: string;
    userId: string;
    newHash: string;
    expiresAt: Date;
  }) {
    await db.transaction(async (tx) => {
      await tx
        .update(refreshTokens)
        .set({
          revokedAt: new Date(),
          replacedByHash: params.newHash,
          updatedAt: new Date(),
        })
        .where(eq(refreshTokens.id, params.oldTokenId));

      await tx.insert(refreshTokens).values({
        userId: params.userId,
        tokenHash: params.newHash,
        expiresAt: params.expiresAt,
      });
    });
  }

  async findLatestVerificationCode(userId: string, onlyUnexpired: boolean = false) {
    const conds = [eq(emailVerificationCodes.userId, userId), isNull(emailVerificationCodes.consumedAt)];
    if (onlyUnexpired) {
      conds.push(gte(emailVerificationCodes.expiresAt, new Date()));
    }
    const [row] = await db
      .select()
      .from(emailVerificationCodes)
      .where(and(...conds))
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);
    return row
      ? {
          id: row.id,
          userId: row.userId,
          codeHash: row.codeHash,
          expiresAt: row.expiresAt,
          attempts: row.attempts,
          consumedAt: row.consumedAt ?? null,
          createdAt: row.createdAt,
        }
      : null;
  }

  async consumeVerificationCode(codeId: string) {
    await db
      .update(emailVerificationCodes)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationCodes.id, codeId));
  }

  async incrementVerificationAttempts(codeId: string, nextAttempts: number, consumedAt: Date | null) {
    await db
      .update(emailVerificationCodes)
      .set({ attempts: nextAttempts, consumedAt })
      .where(eq(emailVerificationCodes.id, codeId));
  }

  async createVerificationCode(params: { userId: string; codeHash: string; expiresAt: Date }) {
    await db.insert(emailVerificationCodes).values({
      userId: params.userId,
      codeHash: params.codeHash,
      expiresAt: params.expiresAt,
      attempts: 0,
    });
  }

  async completeEmailVerification(params: {
    codeId: string;
    userId: string;
    selectedPlanId?: string | null;
  }) {
    await db.transaction(async (tx) => {
      await tx
        .update(emailVerificationCodes)
        .set({ consumedAt: new Date() })
        .where(eq(emailVerificationCodes.id, params.codeId));

      const userPatch: {
        emailVerifiedAt: Date;
        updatedAt: Date;
        selectedPlanId?: string | null;
      } = {
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      };
      if (params.selectedPlanId !== undefined) {
        userPatch.selectedPlanId = params.selectedPlanId;
      }

      await tx.update(users).set(userPatch).where(eq(users.id, params.userId));
    });
  }

  async logoutByTokenHash(tokenHash: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash));
  }
}

export class InMemoryAuthStore implements AuthStore {
  public users = new Map<string, AuthUserRecord>();
  public identities: Array<{ id: string; userId: string; provider: string; providerUserId: string }> = [];
  public refreshTokens: AuthRefreshTokenRecord[] = [];
  public verificationCodes: AuthVerificationCodeRecord[] = [];

  seedUser(user: Partial<AuthUserRecord> & { id: string; email: string }): AuthUserRecord {
    const rec: AuthUserRecord = {
      id: user.id,
      email: user.email,
      canonicalEmail: user.canonicalEmail ?? user.email.trim().toLowerCase(),
      passwordHash: user.passwordHash ?? null,
      role: user.role ?? 'user',
      status: user.status ?? 'active',
      selectedPlanId: user.selectedPlanId ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt ?? new Date(),
    };
    this.users.set(rec.id, rec);
    return rec;
  }

  async findGoogleIdentityByProviderUserId(providerUserId: string) {
    const found = this.identities.find(
      (i) => i.provider === 'google' && i.providerUserId === providerUserId
    );
    return found ? { id: found.id, userId: found.userId } : null;
  }

  async findUserById(userId: string) {
    return this.users.get(userId) || null;
  }

  async findUserByCanonicalOrEmail(canonicalEmail: string, rawEmailLower: string) {
    for (const u of this.users.values()) {
      if (u.canonicalEmail === canonicalEmail || u.email.toLowerCase() === rawEmailLower) {
        return u;
      }
    }
    return null;
  }

  async findUserByCanonicalEmail(canonicalEmail: string) {
    for (const u of this.users.values()) {
      if (u.canonicalEmail === canonicalEmail) {
        return u;
      }
    }
    return null;
  }

  async findUserGoogleIdentity(userId: string) {
    const found = this.identities.find((i) => i.userId === userId && i.provider === 'google');
    return found ? { id: found.id } : null;
  }

  async listUserIdentityProviders(userId: string) {
    return this.identities.filter((i) => i.userId === userId).map((i) => i.provider);
  }

  async insertGoogleIdentity(userId: string, providerUserId: string) {
    this.identities.push({
      id: crypto.randomUUID(),
      userId,
      provider: 'google',
      providerUserId,
    });
  }

  async updateUserFields(
    userId: string,
    patch: Partial<Pick<AuthUserRecord, 'canonicalEmail' | 'selectedPlanId' | 'emailVerifiedAt' | 'lastLoginAt'>>
  ) {
    const existing = this.users.get(userId);
    if (!existing) return;
    Object.assign(existing, patch);
  }

  async createGoogleUserWithRefreshToken(params: {
    replaceExistingUserId?: string;
    email: string;
    canonicalEmail: string;
    selectedPlanId: string | null;
    providerUserId: string;
    generateSession: SessionGenerator;
  }): Promise<GoogleSessionResult> {
    if (params.replaceExistingUserId) {
      this.users.delete(params.replaceExistingUserId);
      this.refreshTokens = this.refreshTokens.filter((t) => t.userId !== params.replaceExistingUserId);
      this.identities = this.identities.filter((i) => i.userId !== params.replaceExistingUserId);
    }

    const id = crypto.randomUUID();
    const rec = this.seedUser({
      id,
      email: params.email,
      canonicalEmail: params.canonicalEmail,
      passwordHash: null,
      role: 'user',
      selectedPlanId: params.selectedPlanId,
      emailVerifiedAt: new Date(),
      lastLoginAt: new Date(),
    });
    await this.insertGoogleIdentity(id, params.providerUserId);
    const session = params.generateSession({
      id,
      email: rec.email,
      role: rec.role,
      selectedPlanId: rec.selectedPlanId,
    });
    await this.insertRefreshToken({
      userId: id,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
    });
    return {
      user: {
        id,
        email: rec.email,
        role: rec.role,
        selectedPlanId: rec.selectedPlanId,
        emailVerified: true,
      },
      accessToken: session.accessToken,
      refreshToken: session.rawRefreshToken,
    };
  }

  async preserveUnverifiedUserWithGoogle(params: {
    userId: string;
    canonicalEmail: string;
    selectedPlanId: string | null;
    providerUserId: string;
    generateSession: SessionGenerator;
  }): Promise<GoogleSessionResult> {
    const u = this.users.get(params.userId)!;
    u.passwordHash = null;
    u.emailVerifiedAt = new Date();
    u.canonicalEmail = params.canonicalEmail;
    u.selectedPlanId = params.selectedPlanId;
    u.lastLoginAt = new Date();
    await this.revokeAllUserRefreshTokens(params.userId);
    for (const c of this.verificationCodes) {
      if (c.userId === params.userId && !c.consumedAt) c.consumedAt = new Date();
    }
    if (!(await this.findUserGoogleIdentity(params.userId))) {
      await this.insertGoogleIdentity(params.userId, params.providerUserId);
    }
    const session = params.generateSession({
      id: u.id,
      email: u.email,
      role: u.role,
      selectedPlanId: params.selectedPlanId,
    });
    await this.insertRefreshToken({
      userId: u.id,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
    });
    return {
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        selectedPlanId: params.selectedPlanId,
        emailVerified: true,
      },
      accessToken: session.accessToken,
      refreshToken: session.rawRefreshToken,
    };
  }

  async insertRefreshToken(params: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.refreshTokens.push({
      id: crypto.randomUUID(),
      userId: params.userId,
      tokenHash: params.tokenHash,
      revokedAt: null,
      replacedByHash: null,
      expiresAt: params.expiresAt,
    });
  }

  async findRefreshTokenByHash(tokenHash: string) {
    return this.refreshTokens.find((t) => t.tokenHash === tokenHash) || null;
  }

  async revokeRefreshToken(tokenId: string) {
    const t = this.refreshTokens.find((x) => x.id === tokenId);
    if (t) t.revokedAt = new Date();
  }

  async revokeAllUserRefreshTokens(userId: string) {
    for (const t of this.refreshTokens) {
      if (t.userId === userId) t.revokedAt = new Date();
    }
  }

  async rotateRefreshToken(params: {
    oldTokenId: string;
    userId: string;
    newHash: string;
    expiresAt: Date;
  }) {
    const old = this.refreshTokens.find((x) => x.id === params.oldTokenId);
    if (old) {
      old.revokedAt = new Date();
      old.replacedByHash = params.newHash;
    }
    await this.insertRefreshToken({
      userId: params.userId,
      tokenHash: params.newHash,
      expiresAt: params.expiresAt,
    });
  }

  async findLatestVerificationCode(userId: string, onlyUnexpired: boolean = false) {
    const now = Date.now();
    const matches = this.verificationCodes
      .filter(
        (c) =>
          c.userId === userId &&
          c.consumedAt === null &&
          (!onlyUnexpired || c.expiresAt.getTime() >= now)
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] || null;
  }

  async consumeVerificationCode(codeId: string) {
    const c = this.verificationCodes.find((x) => x.id === codeId);
    if (c) c.consumedAt = new Date();
  }

  async incrementVerificationAttempts(codeId: string, nextAttempts: number, consumedAt: Date | null) {
    const c = this.verificationCodes.find((x) => x.id === codeId);
    if (c) {
      c.attempts = nextAttempts;
      c.consumedAt = consumedAt;
    }
  }

  async createVerificationCode(params: { userId: string; codeHash: string; expiresAt: Date }) {
    this.verificationCodes.push({
      id: crypto.randomUUID(),
      userId: params.userId,
      codeHash: params.codeHash,
      expiresAt: params.expiresAt,
      attempts: 0,
      consumedAt: null,
      createdAt: new Date(),
    });
  }

  async completeEmailVerification(params: {
    codeId: string;
    userId: string;
    selectedPlanId?: string | null;
  }) {
    await this.consumeVerificationCode(params.codeId);
    const u = this.users.get(params.userId);
    if (u) {
      u.emailVerifiedAt = new Date();
      if (params.selectedPlanId !== undefined) {
        u.selectedPlanId = params.selectedPlanId;
      }
    }
  }

  async logoutByTokenHash(tokenHash: string) {
    const t = this.refreshTokens.find((x) => x.tokenHash === tokenHash);
    if (t) t.revokedAt = new Date();
  }
}

export const defaultAuthStore = new DrizzleAuthStore();
let activeAuthStore: AuthStore = defaultAuthStore;

export function getAuthStore(): AuthStore {
  return activeAuthStore;
}

export function setAuthStoreForTesting(store: AuthStore | null): void {
  activeAuthStore = store || defaultAuthStore;
}
