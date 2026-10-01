import { useState } from 'react'
import type { Member } from '../types'

interface WheelProps {
  /** Members in this wheel's rotation order. */
  members: Member[]
  currentId: string
  /** Shown in the hub of the dial. */
  emoji: string
  label: string
}

/**
 * Circular dial: members sit clockwise in rotation order and the current
 * person is turned to the top. Advancing the rotation spins the dial
 * counter-clockwise, and wrapping around keeps spinning the same way instead
 * of unwinding, because we track total forward steps rather than the index.
 */
export default function Wheel({ members, currentId, emoji, label }: WheelProps) {
  const count = members.length
  const currentIndex = Math.max(
    0,
    members.findIndex((m) => m.id === currentId),
  )

  // Adjust-state-during-render: accumulate forward steps when the current
  // member changes so the dial always animates the short way round.
  const [steps, setSteps] = useState(currentIndex)
  const [prevIndex, setPrevIndex] = useState(currentIndex)
  if (currentIndex !== prevIndex) {
    setSteps(steps + ((currentIndex - prevIndex + count) % count))
    setPrevIndex(currentIndex)
  }

  const slice = 360 / count
  const dialAngle = -steps * slice

  return (
    <div
      role="img"
      aria-label={`${label} wheel, ${members[currentIndex]?.name} is up`}
      className="relative mx-auto aspect-square w-[min(82vw,20rem)]"
      style={{ containerType: 'inline-size' }}
    >
      {/* Static track */}
      <div className="absolute inset-[14.5%] rounded-full border-2 border-dashed border-slate-300 dark:border-slate-700" />

      {/* Fixed pointer marking "up now" */}
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 border-x-[0.9cqw] border-t-[1.6cqw] border-x-transparent border-t-slate-400 dark:border-t-slate-500" />

      {/* Hub */}
      <div className="absolute inset-[34%] flex flex-col items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <span className="text-[9cqw] leading-none">{emoji}</span>
        <span className="mt-[1cqw] text-[4.4cqw] font-medium text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>

      {members.map((member, i) => {
        const angle = i * slice + dialAngle
        const isCurrent = i === currentIndex
        return (
          <div
            key={member.id}
            className="absolute left-1/2 top-1/2 -ml-[11cqw] -mt-[11cqw] flex size-[22cqw] items-center justify-center transition-transform duration-700 ease-[cubic-bezier(0.34,1.25,0.64,1)] motion-reduce:transition-none"
            style={{
              // Orbit around the hub, then counter-rotate so the name stays upright.
              transform: `rotate(${angle}deg) translateY(-35cqw) rotate(${-angle}deg)`,
            }}
          >
            <div
              className={`flex size-full items-center justify-center rounded-full text-[4.6cqw] font-semibold transition-all duration-500 ${
                isCurrent
                  ? 'scale-110 text-white shadow-lg ring-[0.8cqw] ring-white dark:ring-slate-950'
                  : 'scale-90 border-2 bg-white dark:bg-slate-900'
              }`}
              style={
                isCurrent
                  ? { backgroundColor: member.color }
                  : { borderColor: member.color, color: member.color }
              }
            >
              {member.name}
            </div>
          </div>
        )
      })}
    </div>
  )
}
