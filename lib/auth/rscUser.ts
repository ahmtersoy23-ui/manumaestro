/**
 * RSC (Server Component) icin auth helper.
 *
 * Middleware'in x-user-id header'i SSO user_id'yi tasiyor, ama permission
 * tablolari (UserShelfPermission, UserShipmentPermission, vb) lokal
 * users.id'ye FK. Bu helper email uzerinden lokal user'i cozer.
 *
 * API route'larda verifyAuth() ayni isi yapiyor (localUser.id donuyor); bu
 * onun RSC karsiligi.
 */

import { headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';

export type RscUser = {
  id: string;
  email: string;
  role: string;
};

export async function getRscUser(): Promise<RscUser | null> {
  const h = await headers();
  const email = h.get('x-user-email');
  const role = h.get('x-user-role');
  if (!email || !role) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) return null;

  return { id: user.id, email: user.email, role };
}
