import { usePush } from '../data/usePush'
import NotificationBanner from './NotificationBanner'

interface NotificationsProps {
  memberId: string
  passcode: string
  onPasscodeRejected: () => void
}

/** Mounted only once we know who is using the device, so the subscription has an owner. */
export default function Notifications({ memberId, passcode, onPasscodeRejected }: NotificationsProps) {
  const { state, enable } = usePush(memberId, passcode, onPasscodeRejected)
  return <NotificationBanner state={state} onEnable={() => void enable()} />
}
