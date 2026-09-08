import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOwnerEmail } from "@/lib/owner-email";
export { normalizeEmail, ownerEmailSet, isOwnerEmail } from "@/lib/owner-email";

export async function requireOwnerSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isOwnerEmail(session.user.email)) return null;
  return session;
}
