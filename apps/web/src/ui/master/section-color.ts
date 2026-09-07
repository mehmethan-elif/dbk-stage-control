function isNamed(name: string, token: string): boolean {
  const normalized = name.trim().toLocaleUpperCase("tr-TR");
  return normalized === token || normalized.startsWith(`${token} `);
}

export function sectionBarClass(name: string): string {
  if (isNamed(name, "COUNT")) return " section-tone-count";
  if (isNamed(name, "SERBEST")) return " section-tone-serbest";
  if (isNamed(name, "SAN") || isNamed(name, "NAK")) return " section-tone-song";
  if (isNamed(name, "FINAL") || isNamed(name, "RALL")) return " section-tone-final";
  return " section-tone-default";
}
