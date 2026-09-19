const STEPS = ['Pick up', 'On the way', 'Handover'] as const;

/**
 * Where the delivery is: three ticks on a thin line. Done steps are ink,
 * the current step is labelled; green is reserved for the delivered state.
 */
export function StatusRail({ stage }: { stage: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="rail" aria-label="Progress">
      {STEPS.map((label, index) => {
        const state = index < stage ? 'done' : index === stage ? 'current' : 'todo';
        return (
          <li key={label} className={`rail__step rail__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="rail__node" aria-hidden="true" />
            <span className="rail__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
