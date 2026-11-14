import { describe, expect, it } from 'vitest'
import { cleanLabel, isLabeled, personLabel, personTag } from './people'

describe('etiqueta de una persona', () => {
  it('sin etiqueta se queda con su número de seguimiento', () => {
    expect(personLabel({ id: 3 })).toBe('Persona #3')
    expect(personTag({ id: 3 })).toBe('#3')
    expect(isLabeled({ id: 3 })).toBe(false)
    expect(isLabeled({ id: 3, name: '   ' })).toBe(false)
  })

  it('combina dorsal y nombre según lo que haya', () => {
    expect(personLabel({ id: 3, name: 'L. Vidal', number: '10' })).toBe('#10 L. Vidal')
    expect(personLabel({ id: 3, name: 'L. Vidal' })).toBe('L. Vidal')
    expect(personLabel({ id: 3, number: '10' })).toBe('Dorsal 10')
    expect(personTag({ id: 3, name: 'L. Vidal', number: '10' })).toBe('10 L. Vidal')
    expect(isLabeled({ id: 3, number: '10' })).toBe(true)
  })

  it('limpia lo que se escribe antes de guardarlo', () => {
    expect(cleanLabel('  Ana   María  ', ' 7a ')).toEqual({ name: 'Ana María', number: '7' })
    expect(cleanLabel('', '')).toEqual({ name: undefined, number: undefined })
    expect(cleanLabel('x'.repeat(80), '12345').name).toHaveLength(30)
    expect(cleanLabel('x', '12345').number).toBe('123')
  })
})
