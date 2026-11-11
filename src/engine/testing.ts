import partsJson from '../data/parts.json'
import { createCatalog } from './catalog'

/** The real, shipped Vault measurements, for tests that check behaviour against actual parts. */
export const realCatalog = createCatalog(partsJson as unknown as Parameters<typeof createCatalog>[0])
