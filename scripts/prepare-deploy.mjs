import { rm } from 'node:fs/promises'

await rm(new URL('../dist/server/.dev.vars', import.meta.url), { force: true })
