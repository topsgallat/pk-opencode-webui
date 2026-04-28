import { isLocalServer, type ServerConfig } from "./servers"

export interface ServerCapabilities {
  isRemoteBackend: boolean
  canBrowseDirectories: boolean
  canCreateDirectories: boolean
  canUseLocalExtFileOps: boolean
  canReadLocalLogs: boolean
  canEditLocalInstructionFiles: boolean
}

export function getServerCapabilities(server?: Pick<ServerConfig, "url">): ServerCapabilities {
  const isRemoteBackend = !isLocalServer(server)
  return {
    isRemoteBackend,
    canBrowseDirectories: !isRemoteBackend,
    canCreateDirectories: !isRemoteBackend,
    canUseLocalExtFileOps: !isRemoteBackend,
    canReadLocalLogs: !isRemoteBackend,
    canEditLocalInstructionFiles: !isRemoteBackend,
  }
}
