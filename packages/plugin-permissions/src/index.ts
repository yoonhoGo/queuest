export {
  calculatePermissionDiff,
  computePermissionDiff,
  diffPermissions,
  diffPermissionState,
  diffPluginPermissions,
  hasMissingPermissions,
  isEmptyPermissions,
  isPermissionSubset,
  mergePermissions,
  normalizePermissions,
  normalizePluginPermissions,
  permissionIsCovered,
  permissionState,
  subtractGrantedPermissions,
  type PermissionDiff,
  type PermissionInput,
  type PermissionState,
  type PluginPermissionState,
} from "./permissions.ts";

export {
  AtomicJsonPermissionApprovalStore,
  AtomicJsonApprovalStore,
  JsonPermissionApprovalStore,
  MemoryPermissionApprovalStore,
  PERMISSION_APPROVAL_SCHEMA_VERSION,
  PLUGIN_PERMISSION_APPROVAL_SCHEMA_VERSION,
  type JsonPermissionApprovalStoreOptions,
  type PermissionApprovalMap,
  type PermissionApprovalStore,
} from "./approval-store.ts";

export {
  PermissionBroker,
  PermissionBrokerError,
  type PermissionBrokerOptions,
} from "./broker.ts";

export {
  DEFAULT_KEYCHAIN_NAMESPACE,
  DEFAULT_KEYCHAIN_SECURITY_PATH,
  CredentialStoreError,
  MacOSKeyChainCredentialStore,
  MacOSKeychainCredentialStore,
  MacOSKeychainStore,
  MemoryCredentialStore,
  createKeychainCredentialIdentifiers,
  keychainCredentialIdentifiers,
  type CredentialCommandResult,
  type CredentialExecFile,
  type CredentialReference,
  type CredentialStore,
  type KeychainCredentialIdentifiers,
  type KeychainCredentialStoreOptions,
  type KeychainIdentifierOptions,
  type MacOSKeychainCredentialStoreOptions,
} from "./credentials.ts";
