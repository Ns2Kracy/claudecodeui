import CodexLogo from '../../../../llm-logo-provider/CodexLogo.js';

import type { NineRouterProviderIcon } from './ProviderCatalog.js';

type ProviderIconProps = {
  icon: NineRouterProviderIcon;
  label: string;
  className?: string;
};

/** Gives the Provider Router connection and account surfaces one accessible provider identity. */
export default function ProviderIcon({ icon, label, className = 'h-5 w-5' }: ProviderIconProps) {
  if (icon === 'codex') return <CodexLogo className={className} />;

  const text = {
    openai: 'AI',
    anthropic: 'A',
    gemini: 'G',
    deepseek: 'DS',
    openrouter: 'OR',
    compatible: '<>',
  }[icon];

  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex items-center justify-center font-mono text-[9px] font-semibold leading-none ${className}`}
    >
      {text}
    </span>
  );
}
