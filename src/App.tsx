import { useState } from 'react'
import { readStored, STORAGE_KEYS, writeStored } from './lib/storage'
import Home from './screens/Home'
import PasscodeGate from './screens/PasscodeGate'

function App() {
  const [passcode, setPasscode] = useState<string | null>(() => readStored(STORAGE_KEYS.passcode))
  const [gateNotice, setGateNotice] = useState<string | null>(null)

  function forgetPasscode(notice: string | null) {
    writeStored(STORAGE_KEYS.passcode, null)
    setPasscode(null)
    setGateNotice(notice)
  }

  if (!passcode) {
    return (
      <PasscodeGate
        notice={gateNotice}
        onUnlock={(entered) => {
          writeStored(STORAGE_KEYS.passcode, entered)
          setPasscode(entered)
          setGateNotice(null)
        }}
      />
    )
  }

  return (
    <Home
      passcode={passcode}
      onPasscodeRejected={() =>
        forgetPasscode('The household passcode has changed. Enter the new one.')
      }
      onLock={() => forgetPasscode(null)}
    />
  )
}

export default App
