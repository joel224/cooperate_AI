'use client';
import { SessionProvider } from 'next-auth/react';

import React, { ReactNode } from 'react';


export function SessionProviderWrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}


