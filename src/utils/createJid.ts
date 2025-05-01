/**
 * Converte qualquer “número” ou JID informado em um JID válido para o WhatsApp.
 *  - preserva JIDs já completos (@s.whatsapp.net, @g.us, @lid, @broadcast)
 *  - faz normalização BR / MX / AR quando necessário
 */
function formatMXorAR(number: string): string {
  const cc = number.slice(0, 2);
  if (cc === '52' || cc === '54') {
    // ex.: 521234567890 → 521234567890   | 52123*** → idem
    return number.length === 13 ? cc + number.slice(3) : number;
  }
  return number;
}

function formatBR(number: string): string {
  // 55(DD)9XXXXXXXX: remove o “9” quando é linha fixa ou DDD<31
  const re = /^(\d{2})(\d{2})\d(\d{8})$/;      // 55 11 9 12345678
  const m  = re.exec(number);
  if (!m) return number;

  const [, cc, ddd, rest] = m;
  const firstDigit = Number(rest[0]);
  if (cc === '55' && (firstDigit < 7 || Number(ddd) < 31)) {
    return m[0];                // mantém como veio
  }
  return `${cc}${ddd}${rest}`;  // remove o “9”
}

/** Exporta função principal */
export function createJid(raw: string): string {
  let number = raw.replace(/:\d+/, '');

  // já é JID completo
  if (/@(g\.us|s\.whatsapp\.net|lid|broadcast)$/.test(number)) return number;

  // limpeza básica
  number = number
    .replace(/[\s+()]/g, '')
    .split(/[:@]/)[0]           // remove :device ou @jid
    .replace(/\D/g, '');

  // grupos (contém ‘-’ ou ≥ 18 dígitos)
  if (number.includes('-') && number.length >= 24) return `${number}@g.us`;
  if (number.length >= 18)                          return `${number}@g.us`;

  // ajustes regionais
  number = formatMXorAR(number);
  number = formatBR(number);

  return `${number}@s.whatsapp.net`;
}
