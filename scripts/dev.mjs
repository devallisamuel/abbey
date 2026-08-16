import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const useShell = process.platform === 'win32'
const children = [
  spawn(npmCommand, ['run', 'dev:server'], { stdio: 'inherit', shell: useShell }),
  spawn(npmCommand, ['run', 'dev:client'], { stdio: 'inherit', shell: useShell }),
]

let shuttingDown = false

const shutdown = (code = 0) => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
      continue
    }

    child.kill('SIGTERM')
  }

  process.exit(code)
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0)
    }
  })

  child.on('error', () => {
    shutdown(1)
  })
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
