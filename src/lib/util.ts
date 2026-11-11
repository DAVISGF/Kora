export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

const pad = (n: number) => (n < 10 ? '0' : '') + n

/** Segundos → hh:mm:ss */
export function fmtTime(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Segundos → mm:ss (para duraciones cortas) */
export function fmtShort(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

export const comma = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')

/** Descarga un archivo de texto generado en el navegador. */
export function downloadText(filename: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Generador pseudoaleatorio con semilla, para datos de ejemplo estables. */
export function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}
