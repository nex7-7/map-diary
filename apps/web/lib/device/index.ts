// The device layer for the rest of the web app: who is signed in, the local diary store
// and its sync loop. UI code reads items here and never touches keys or libsodium.
export { useSession, useDiaryItems, useSyncStatus, type SessionState } from "./hooks";
export { getSession, adoptDevice, forgetDevice, api } from "./session";
export { DeviceGate } from "./gate";
export { currentDeviceKind } from "./kind";
export { addDevice, choosePassphrase, listDevices, removeDevice, type AccountOverview, type ListedDevice } from "./devices";
export {
  cancelInvite,
  inviteFriend,
  inviteNotes,
  members,
  openInvites,
  removeFromApp,
  saveInviteNote,
  type AppInviteView,
  type MemberView,
  type NewAppInvite,
} from "./admin";
export type { Diary, DiaryItem, SyncStatus, WriteInput } from "@map-diary/sync";
