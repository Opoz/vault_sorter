// Renders a one-unit tower in the 3D view with the real Vault parts, for checking poses (see README.md).
// Usage: node scripts/inspect/render.mjs <out.png> <cam az,el> <spread 0-1> <roof> <only-regex> <palette index> <depth> [plate|rails]
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
// The dev server to drive, and the Vault download to load into the 3D view (never committed; see README).
const URL = process.env.PLANNER_URL ?? 'http://localhost:5173/'
const VAULT = process.env.VAULT_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../261021_VAULT_USSA_S')
const [out = 'check.png', cam = '-40,30', spread = '0', roof = 'none'] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) })
await p.addInitScript(() => { delete window.showDirectoryPicker })
const errors = []; p.on('pageerror', (e) => errors.push(e.message))
await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.goto(URL + '?cam=' + cam + (process.argv[6] ? '&only=' + encodeURIComponent(process.argv[6]) : ''))
if (process.env.SPLIT) { await p.getByLabel('Parts that come split').selectOption(process.env.SPLIT); await p.waitForTimeout(200) }
await p.locator('.palette button, .palette [role=button]').nth(Number(process.argv[7] ?? 0)).click(); await p.waitForTimeout(400)
await p.locator('.tower-name, .tower-head').first().click(); await p.waitForTimeout(300)
const roofSelect = p.locator('label:has-text("Roof") + select, select').filter({ has: p.locator('option[value="grid"]') }).first()
await roofSelect.selectOption(roof); await p.waitForTimeout(200)
if (process.env.BACKBONE) { await p.locator('select').filter({ has: p.locator('option[value="universal"]') }).first().selectOption(process.env.BACKBONE); await p.waitForTimeout(200) }
if (process.env.STAT) { await p.getByLabel('Stationary handle').check(); await p.waitForTimeout(200) }
if (process.env.PULL) { await p.getByLabel(/Pull-out handle/).check(); await p.waitForTimeout(200) }
if (process.env.PEG) { await p.locator('select').filter({ has: p.locator('option[value="skadis"]') }).first().selectOption(process.env.PEG); await p.waitForTimeout(200) }
if (process.env.WALL) { await p.getByLabel(/Hang on a wall/).check(); await p.waitForTimeout(200) }
if (process.env.BOTTOM) { await p.locator('select').filter({ has: p.locator('option[value="casters"]') }).first().selectOption(process.env.BOTTOM); await p.waitForTimeout(200) }
await p.locator('.depth-option').filter({ hasText: new RegExp('^' + (process.argv[8] ?? '3')) }).locator('input').check(); await p.waitForTimeout(200)
if (process.env.NOSEL !== '1') { await p.locator('.placed').first().click(); await p.waitForTimeout(200) }
if (process.env.BOXES) { await p.getByLabel('Boxes in this module').selectOption(process.env.BOXES); await p.waitForTimeout(300) }
if (process.argv[9] === 'plate') { await p.getByLabel('Gridfinity baseplate').selectOption({ index: 1 }); await p.waitForTimeout(200) }
if (process.argv[9] === 'rails') { await p.getByLabel(/Geared rails/).check(); await p.waitForTimeout(200) }
await p.getByRole('button', { name: '3D', exact: true }).click(); await p.waitForSelector('.scene3d canvas')
const chooser = p.waitForEvent('filechooser')
await p.locator('.scene3d-note').getByRole('button', { name: 'Choose your Vault folder' }).click()
await (await chooser).setFiles(VAULT)
for (let i = 0; i < 120 && /Loading/.test(await p.locator('.scene3d-note').innerText()); i++) await p.waitForTimeout(500)
if (process.env.Q) { await p.getByRole('button', { name: process.env.Q, exact: true }).click(); await p.waitForTimeout(500); for (let i = 0; i < 240 && /Loading/.test(await p.locator('.scene3d-note').innerText()); i++) await p.waitForTimeout(500) }
await p.locator('.scene3d-spread input').fill(spread)
await p.waitForTimeout(1200)
await p.locator('.scene3d').screenshot({ path: out })
console.log(out, errors)
await b.close()
