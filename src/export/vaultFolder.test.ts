import { describe, expect, it } from 'vitest'
import { filesSource } from './vaultFolder'

const file = (relativePath: string, text = relativePath) =>
  Object.assign(new File([text], relativePath.split('/').pop()!), { webkitRelativePath: relativePath })

describe('filesSource (folder input, for Firefox)', () => {
  it('finds parts by their Vault path when the folder above the download was chosen', async () => {
    const source = filesSource([
      file('Downloads/261021_VAULT_USSA_S/01. DRAWERS/07. Universal/Latch.stl', 'latch'),
      file('Downloads/261021_VAULT_USSA_S/02. SUSTAINERS/05. Universal/Rods/S-M Rods.stl'),
      file('Downloads/__MACOSX/261021_VAULT_USSA_S/01. DRAWERS/07. Universal/._Latch.stl'),
    ])

    expect(source.name).toBe('261021_VAULT_USSA_S')
    expect(await (await source.readFile('01. DRAWERS/07. Universal/Latch.stl')).text()).toBe('latch')
  })

  it('works when the download folder itself was chosen', async () => {
    const source = filesSource([file('261021_VAULT_USSA_S/01. DRAWERS/07. Universal/Latch.stl', 'latch')])
    expect(await (await source.readFile('01. DRAWERS/07. Universal/Latch.stl')).text()).toBe('latch')
  })

  it('refuses a folder that is not the Vault download', () => {
    expect(() => filesSource([file('Photos/cat.jpg')])).toThrow(/Vault download/)
  })

  it('says which file is missing', async () => {
    const source = filesSource([file('V/01. DRAWERS/07. Universal/Latch.stl')])
    await expect(source.readFile('01. DRAWERS/07. Universal/Key Cap.stl')).rejects.toThrow(/Key Cap/)
  })
})
