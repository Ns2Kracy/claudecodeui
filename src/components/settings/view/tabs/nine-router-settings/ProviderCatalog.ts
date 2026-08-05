import type { RoutingProviderConnectionMethod } from '../../../../../../shared/routing.js';

export type NineRouterProviderProfile = {
  id: string;
  name: string;
  methods: RoutingProviderConnectionMethod[];
};

export const NINE_ROUTER_PROVIDER_PROFILES: NineRouterProviderProfile[] = [
  { id: 'openai', name: 'OpenAI', methods: ['api_key'] },
  { id: 'claude', name: 'Claude', methods: ['oauth'] },
  { id: 'github', name: 'GitHub Copilot', methods: ['device_code'] },
  { id: 'custom', name: 'Custom provider', methods: ['custom'] },
];

export function methodsForProvider(provider: string): RoutingProviderConnectionMethod[] {
  return NINE_ROUTER_PROVIDER_PROFILES.find((profile) => profile.id === provider)?.methods ?? [];
}
