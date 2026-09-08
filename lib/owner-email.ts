export function normalizeEmail(email?: string | null): string {
  return String(email || "").trim().toLowerCase();
}

export function ownerEmailSet(): Set<string> {
  return new Set(String(process.env.OWNER_EMAILS || "").split(",").map(normalizeEmail).filter(Boolean));
}

export function isOwnerEmail(email?: string | null): boolean {
  const owners = ownerEmailSet();
  return owners.size > 0 && owners.has(normalizeEmail(email));
}
