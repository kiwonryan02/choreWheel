interface NudgeBannerProps {
  choreName: string
  onDismiss: () => void
}

/** Shown to the person on top after someone bumped them. It never says who. */
export default function NudgeBanner({ choreName, onDismiss }: NudgeBannerProps) {
  return (
    <div
      role="status"
      className="mx-6 mt-1 flex items-start justify-between gap-3 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
    >
      <p>
        <span className="font-semibold">Friendly nudge:</span> the {choreName.toLowerCase()} is waiting on
        you.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss the ${choreName.toLowerCase()} nudge`}
        className="shrink-0 font-semibold underline underline-offset-4"
      >
        Got it
      </button>
    </div>
  )
}
