import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export type GitExec = (command: string) => string

const defaultGitExec: GitExec = (command) =>
  execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()

export const resolveCommitSha = (exec: GitExec = defaultGitExec): string => {
  try {
    const sha = exec('git rev-parse --short HEAD').trim()
    return sha || 'unknown'
  } catch {
    return 'unknown'
  }
}

export const readPipelineVersion = (): string => {
  try {
    const pkgPath = join(here, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface BuildMetadata {
  commitSha: string
  timestamp: string
  pipelineVersion: string
}

export const collectBuildMetadata = (): BuildMetadata => ({
  commitSha: resolveCommitSha(),
  timestamp: new Date().toISOString(),
  pipelineVersion: readPipelineVersion(),
})

export const buildDefines = (metadata: BuildMetadata): Record<string, string> => ({
  __BUILD_COMMIT_SHA__: JSON.stringify(metadata.commitSha),
  __BUILD_TIMESTAMP__: JSON.stringify(metadata.timestamp),
  __PIPELINE_VERSION__: JSON.stringify(metadata.pipelineVersion),
})
