"use client";

import { createAuthClient } from "better-auth/react";

// Sem `baseURL`: o client usa `/api/auth` (mesma origem), que é onde
// app/api/auth/[...all]/route.ts expõe o handler do Better Auth.
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
