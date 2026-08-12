import type { ActiveProvider } from '../../../provider-auth/types';

export type OnboardingAgentCard = {
  provider: ActiveProvider;
  title: string;
  connectedClassName: string;
  iconContainerClassName: string;
  loginButtonClassName: string;
};

export const ONBOARDING_AGENT_CARDS: readonly OnboardingAgentCard[] = [
  {
    provider: 'codex',
    title: 'OpenAI Codex',
    connectedClassName: 'bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600',
    iconContainerClassName: 'bg-gray-100 dark:bg-gray-800',
    loginButtonClassName: 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600',
  },
];
